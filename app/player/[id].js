import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Platform } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio"; // ✅ new
import { useFonts } from "expo-font";
import { Amiri_400Regular, Amiri_700Bold } from "@expo-google-fonts/amiri";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";
import { MUTOON_ASSETS } from "../lib/mutoonAssets.js";

// --- keep your helpers: timeToMs, parseSrt, findCueIndex ---
// Ensure parseSrt uses "-->" not "&gt;" (real arrow), like:
// /(\d\d:\d\d:\d\d,\d\d\d)\s*-->\s*(\d\d:\d\d:\d\d,\d\d\d)/

export default function Player() {
  const { id } = useLocalSearchParams();
  const key = String(id);
  const entry = MUTOON_ASSETS[key];

  const scrollRef = useRef(null);

  const [fontsLoaded] = useFonts({ Amiri_400Regular, Amiri_700Bold });
  const font = fontsLoaded ? "Amiri_400Regular" : Platform.select({ ios: "System", android: "sans-serif" });
  const fontBold = fontsLoaded ? "Amiri_700Bold" : font;

  // Load SRT text from bundled asset (your existing approach)
  const [srtText, setSrtText] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!entry?.srt) return;
      const asset = Asset.fromModule(entry.srt);
      await asset.downloadAsync(); // ensures localUri is available
      if (cancelled) return;
      const text = await FileSystem.readAsStringAsync(asset.localUri);
      if (!cancelled) setSrtText(text);
    })();
    return () => { cancelled = true; };
  }, [entry?.srt]);

  const cues = useMemo(() => (srtText ? parseSrt(srtText) : []), [srtText]);

  // ✅ expo-audio: create player + status
  const player = useAudioPlayer(entry?.audio); // entry.audio should be require(...) (local asset)
  const status = useAudioPlayerStatus(player); // recommended way to observe status

  const [activeIndex, setActiveIndex] = useState(0);
  const [repeatLine, setRepeatLine] = useState(false);

  // Convert status time (seconds) -> ms for your cue logic
  const positionMs = Math.floor((status?.currentTime ?? 0) * 1000);

  useEffect(() => {
    if (!cues.length) return;

    const idx = findCueIndex(cues, positionMs);

    if (idx !== activeIndex) {
      setActiveIndex(idx);
      scrollRef.current?.scrollTo({ y: Math.max(0, idx * 72 - 120), animated: true });
    }

    // Repeat-line: if we reached end of cue, seek back
    if (repeatLine) {
      const c = cues[idx];
      if (c && positionMs >= c.endMs - 40) {
        player.seekTo(c.startMs / 1000); // seekTo expects seconds
        player.play();
      }
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

  if (!entry) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Unknown item: {key}</Text>
      </View>
    );
  }

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

      <View style={styles.activeBox}>
        <Text style={[styles.activeText, { fontFamily: font, writingDirection: "rtl", textAlign: "right" }]}>
          {cues[activeIndex]?.text ?? ""}
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
  btn: { borderWidth: 1, borderColor: "#2a2a2a", backgroundColor: "#111", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12 },
  btnText: { color: "#e5e5e5", fontSize: 12, fontWeight: "600" },
  activeBox: { borderWidth: 1, borderColor: "#222", borderRadius: 14, backgroundColor: "#111", padding: 12, marginBottom: 10 },
  activeText: { color: "#fff", fontSize: 18, lineHeight: 34 },
  meta: { color: "#a3a3a3", fontSize: 11, marginTop: 8 },
  list: { borderWidth: 1, borderColor: "#222", borderRadius: 14, backgroundColor: "#0f0f0f", padding: 8 },
  item: { borderWidth: 1, borderColor: "#1f1f1f", backgroundColor: "#0b0b0b", borderRadius: 12, padding: 10, marginBottom: 8 },
  itemActive: { backgroundColor: "#fff", borderColor: "#fff" },
  itemMeta: { color: "#7d7d7d", fontSize: 11, marginBottom: 6 },
  itemText: { color: "#fff", fontSize: 16, lineHeight: 30 },
});