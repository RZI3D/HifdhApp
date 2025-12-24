import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

const MUTOON = [
  { id: "shurut-salah", titleAr: "شروط الصلاة وأركانها وواجباتها" },
];

export default function Library() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>مُتون</Text>
      <Text style={styles.sub}>اختر المتن</Text>

      {MUTOON.map((m) => (
        <Pressable
          key={m.id}
          style={styles.card}
          onPress={() => router.push(`/player/${m.id}`)}
        >
          <Text style={styles.cardTitle}>{m.titleAr}</Text>
          <Text style={styles.cardSub}>Audio-only • SRT sync • Repeat line</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 16 },
  title: { color: "#fff", fontSize: 28, fontWeight: "700", marginTop: 8 },
  sub: { color: "#a3a3a3", fontSize: 14, marginBottom: 16 },
  card: {
    backgroundColor: "#111",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  cardSub: { color: "#a3a3a3", fontSize: 12, marginTop: 6 },
});