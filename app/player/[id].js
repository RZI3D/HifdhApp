import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Platform } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useFonts } from "expo-font";
import { Amiri_400Regular, Amiri_700Bold } from "@expo-google-fonts/amiri";

import { Asset } from "expo-asset";

import { MUTOON_ASSETS } from "../lib/mutoonAssets.js";

// Bidi marks (RTL/LTR embedding/override/isolates) that can break parsing
const BIDI_MARKS_RE = /[‎‏‪-‮⁦-⁩]/g;

// Zero-width and BOM variants often present in copied/edited subtitle files
const ZERO_WIDTH_RE = /[​‌‍⁠﻿]/g;

// Non-breaking spaces and other "weird" spaces
const WEIRD_SPACES_RE = /[  ᠎ -   　]/g;

/**
 * Normalize a timestamp (or any timing string) into clean ASCII:
 * - removes bidi + zero-width
 * - normalizes Arabic punctuation to ASCII
 * - converts Arabic-Indic digits to western digits
 * - strips ALL whitespace (including NBSP variants)
 */
function normalizeTimeString(raw) {
  if (raw == null) return "";

  let s = String(raw);

  // Remove invisible marks
  s = s.replace(BIDI_MARKS_RE, "").replace(ZERO_WIDTH_RE, "");

  // Normalize weird spaces to regular spaces, then remove whitespace completely
  s = s.replace(WEIRD_SPACES_RE, " ");

  // Normalize Arabic punctuation/separators to ASCII equivalents
  s = s
    .replace(/\u060C/g, ",") // Arabic comma: ،
    .replace(/\u066B/g, ",") // Arabic decimal separator
    .replace(/\u066C/g, "")  // Arabic thousands separator
    .replace(/\uFF0C/g, ",") // Fullwidth comma
    .replace(/\uFE10/g, ",") // Presentation comma
    .replace(/\uFE11/g, ",")
    .replace(/\uFF1A/g, ":") // Fullwidth colon
    .replace(/\uFE13/g, ":") // Presentation colon
    .replace(/\uFE55/g, ":") // Small colon
    .replace(/\u2236/g, ":"); // Ratio symbol sometimes used like colon

  // Normalize Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩)
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  // Normalize Eastern Arabic-Indic digits (۰۱۲۳۴۵۶۷۸۹)
  s = s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

  // Strip all whitespace (including normal spaces/tabs/newlines)
  s = s.replace(/\s+/g, "").trim();

  return s;
}

/**
 * Convert SRT timestamp -> milliseconds
 * Accepts: HH:MM:SS,mmm  and  HH:MM:SS.mmm
 * Hours can be 1+ digits.
 */
function timeToMs(raw) {
  const t = normalizeTimeString(raw);

  const m = t.match(/^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})/);
  if (!m) {
    return 0;
  }

  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const ms = Number(m[4].padEnd(3, "0"));

  return ((hh * 60 + mm) * 60 + ss) * 1000 + ms;
}

/**
 * Parse the timing line robustly.
 * We normalize the line, then extract start/end around an arrow.
 */
function parseTimingLine(rawLine) {
  if (!rawLine) return null;

  // Keep arrow characters, but remove invisible junk + whitespace + normalize digits/punct.
  const line = normalizeTimeString(rawLine);

  // Accept common arrows: -->, —>, –>
  // After whitespace stripping, it's usually "00:..,.." + "-->" + "00:..,.."
  const match = line.match(
    /(\d+:\d{2}:\d{2}[.,]\d{1,3})(?:-->|—>|–>)(\d+:\d{2}:\d{2}[.,]\d{1,3})/ 
  );

  if (!match) {
    return null;
  }

  const startRaw = match[1];
  const endRaw = match[2];

  const startMs = timeToMs(startRaw);
  const endMs = timeToMs(endRaw);

  return { startMs, endMs, startRaw, endRaw, normalizedLine: line };
}

/**
 * Parse SRT into cues:
 * [{ index, startMs, endMs, text }]
 */
function parseSrt(srtText) {
  if (!srtText) return [];

  const normalized = srtText
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const blocks = normalized
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const cues = [];
  let cueIndex = 0;

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trimEnd());

    // Find timing line (contains --> or variants)
    let timeLineIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeLineIdx === -1) {
      timeLineIdx = lines.findIndex((l) => /-->|—>|–>/.test(l));
    }
    if (timeLineIdx === -1) continue;

    const timeLineRaw = lines[timeLineIdx];
    const timing = parseTimingLine(timeLineRaw);
    if (!timing) continue;

    const { startMs, endMs } = timing;

    // Text lines are everything after timing line
    const bodyLines = lines.slice(timeLineIdx + 1).filter((l) => l.length > 0);
    const cueText = bodyLines.join("\n").trim();

    cues.push({
      index: cueIndex++,
      startMs,
      endMs,
      text: cueText,
    });
  }

  // Sort by start time; then re-index
  cues.sort((a, b) => a.startMs - b.startMs);
  return cues.map((c, i) => ({ ...c, index: i }));
}

/**
 * Binary search to find active cue index by time (ms)
 */
function findCueIndex(cues, positionMs) {
  if (!cues || cues.length === 0) return 0;

  let lo = 0;
  let hi = cues.length - 1;
  let best = 0;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid];

    if (positionMs < c.startMs) {
      hi = mid - 1;
    } else if (positionMs > c.endMs) {
      best = mid;
      lo = mid + 1;
    } else {
      return mid;
    }
  }

  return Math.max(0, Math.min(best, cues.length - 1));
}

export default function Player() {
  const { id } = useLocalSearchParams();
  const key = String(id);
  const entry = MUTOON_ASSETS[key];

  // Hook safety: do not run audio/fs hooks without a valid entry
  if (!entry) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Unknown item: {key}</Text>
      </View>
    );
  }

  return <PlayerInner entry={entry} />;
}

function PlayerInner({ entry }) {
  const scrollRef = useRef(null);

  // Fonts
  const [fontsLoaded] = useFonts({ Amiri_400Regular, Amiri_700Bold });
  const fallbackFont = Platform.select({ ios: "System", android: "sans-serif" });
  const font = fontsLoaded ? "Amiri_400Regular" : fallbackFont;
  const fontBold = fontsLoaded ? "Amiri_700Bold" : fallbackFont;

  // SRT state
  const [srtText, setSrtText] = useState("");
  const [srtError, setSrtError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setSrtError("");
        setSrtText("");

        const asset = Asset.fromModule(entry.srt);
        await asset.downloadAsync();

        if (cancelled) return;

        // Native-only: should be a local file URI after downloadAsync
        const uri = asset.localUri ?? asset.uri;

        const response = await fetch(uri);
        const text = await response.text();

        if (!cancelled) setSrtText(text);
      } catch (e) {
        if (!cancelled) setSrtError(String(e?.message ?? e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entry?.srt]);

  const cues = useMemo(() => (srtText ? parseSrt(srtText) : []), [srtText]);

  // Audio
  const player = useAudioPlayer(entry.audio);
  const status = useAudioPlayerStatus(player);

  const [activeIndex, setActiveIndex] = useState(0);
  const [repeatLine, setRepeatLine] = useState(false);
  const lastRepeatRef = useRef(-1);

  useEffect(() => {
    setActiveIndex(0);
    lastRepeatRef.current = -1;
  }, [cues.length]);

  const positionMs = Math.floor((status?.currentTime ?? 0) * 1000);

  useEffect(() => {
    if (!cues.length) return;

    const idx = findCueIndex(cues, positionMs);

    if (idx !== activeIndex) {
      setActiveIndex(idx);
      scrollRef.current?.scrollTo({
        y: Math.max(0, idx * 72 - 120),
        animated: true,
      });
    }

    if (repeatLine) {
      const c = cues[idx];
      if (!c) return;

      if (positionMs >= c.endMs - 40 && lastRepeatRef.current !== c.index) {
        lastRepeatRef.current = c.index;
        player.seekTo(c.startMs / 1000);
        player.play();
      }
    } else {
      lastRepeatRef.current = -1;
    }
  }, [positionMs, cues, repeatLine, activeIndex, player]);

  const togglePlay = () => {
    if (status?.playing) player.pause();
    else player.play();
  };

  const seekToCue = (i) => {
    const c = cues[i];
    if (!c) return;
    player.seekTo(c.startMs / 1000);
    player.play();
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { fontFamily: fontBold }]}>{entry.titleAr}</Text>

      <View style={styles.row}>
        <Pressable style={styles.primary} onPress={togglePlay}>
          <Text style={styles.primaryText}>{status?.playing ? "Pause" : "Play"}</Text>
        </Pressable>

        <Pressable style={styles.btn} onPress={() => setRepeatLine((v) => !v)}>
          <Text style={styles.btnText}>Repeat Line: {repeatLine ? "ON" : "OFF"}</Text>
        </Pressable>
      </View>

      {!!srtError && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>SRT load error:</Text>
          <Text style={styles.errorTextSmall}>{srtError}</Text>
        </View>
      )}

      <View style={styles.activeBox}>
        <Text
          style={[ 
            styles.activeText,
            { fontFamily: font, writingDirection: "rtl", textAlign: "right" },
          ]}
        >
          {cues[activeIndex]?.text ?? "Loading subtitles…"}
        </Text>

        <Text style={styles.meta}>
          #{activeIndex} • {cues[activeIndex]?.startMs ?? 0}–{cues[activeIndex]?.endMs ?? 0}ms
        </Text>
      </View>

      <ScrollView ref={scrollRef} style={styles.list}>
        {cues.map((c) => {
          const active = c.index === activeIndex;
          return (
            <Pressable
              key={c.index}
              style={[styles.item, active && styles.itemActive]}
              onPress={() => seekToCue(c.index)}
            >
              <Text style={[styles.itemMeta, active && { color: "#000" }]}>
                #{c.index} • {c.startMs}–{c.endMs}ms
              </Text>

              <Text
                style={[ 
                  styles.itemText,
                  { fontFamily: font, writingDirection: "rtl", textAlign: "right" },
                  active && { color: "#000" },
                ]}
              >
                {c.text}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 14 },
  title: { color: "#fff", fontSize: 18, marginBottom: 10 },

  row: { flexDirection: "row", gap: 10, flexWrap: "wrap", marginBottom: 10 },

  primary: { backgroundColor: "#fff", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12 },
  primaryText: { color: "#000", fontWeight: "700" },

  btn: {
    borderWidth: 1,
    borderColor: "#2a2a2a",
    backgroundColor: "#111",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  btnText: { color: "#e5e5e5", fontSize: 12, fontWeight: "600" },

  errorBox: {
    borderWidth: 1,
    borderColor: "#522",
    borderRadius: 14,
    backgroundColor: "#1a0f0f",
    padding: 12,
    marginBottom: 10,
  },
  errorText: { color: "#ffb4b4", fontWeight: "800", marginBottom: 4 },
  errorTextSmall: { color: "#ffb4b4", fontSize: 12 },

  activeBox: {
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 14,
    backgroundColor: "#111",
    padding: 12,
    marginBottom: 10,
  },
  activeText: { color: "#fff", fontSize: 18, lineHeight: 34 },
  meta: { color: "#a3a3a3", fontSize: 11, marginTop: 8 },

  list: {
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 14,
    backgroundColor: "#0f0f0f",
    padding: 8,
  },
  item: {
    borderWidth: 1,
    borderColor: "#1f1f1f",
    backgroundColor: "#0b0b0b",
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  itemActive: { backgroundColor: "#fff", borderColor: "#fff" },
  itemMeta: { color: "#7d7d7d", fontSize: 11, marginBottom: 6 },
  itemText: { color: "#fff", fontSize: 16, lineHeight: 30 },
});
