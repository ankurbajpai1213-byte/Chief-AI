import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from "react-native";
import { supabase } from "../supabase";
import { radius, space, useColors } from "../theme";
import { Body, Button, H1, Label } from "../ui";

export default function Login() {
  const c = useColors();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const submit = async () => {
    setMsg(null);
    if (!email.includes("@") || password.length < 8) {
      setMsg({ text: "Enter your email and a password of at least 8 characters.", bad: true });
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (!data.session) {
          setMode("signin");
          setMsg({ text: "Account created. Open the confirmation email we sent, then sign in here." });
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : "Couldn't sign in.";
      setMsg({ text: /confirm/i.test(text) ? "Confirm your email first: open the link we sent, then sign in." : text, bad: true });
    } finally {
      setBusy(false);
    }
  };

  const input = [s.input, { borderColor: c.line, color: c.ink, backgroundColor: c.surface }];

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[s.wrap, { backgroundColor: c.bg }]}>
      <View style={s.inner}>
        <Label style={{ color: c.chief }}>Your chief of staff</Label>
        <H1>Chief</H1>
        <Body muted>Remembers what you committed to, checks if it happened, and helps you choose.</Body>

        <View style={{ gap: space.sm, marginTop: space.lg }}>
          <TextInput
            style={input} placeholder="Email" placeholderTextColor={c.muted}
            autoCapitalize="none" autoComplete="email" keyboardType="email-address"
            value={email} onChangeText={setEmail}
          />
          <TextInput
            style={input} placeholder="Password (8+ characters)" placeholderTextColor={c.muted}
            secureTextEntry autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password} onChangeText={setPassword} onSubmitEditing={submit}
          />
          {msg && <Body style={{ color: msg.bad ? c.slip : c.done }}>{msg.text}</Body>}
          <Button title={mode === "signup" ? "Create account" : "Sign in"} filled busy={busy} onPress={submit} />
          <Button
            title={mode === "signup" ? "I already have an account" : "Create a new account"}
            tone="plain"
            onPress={() => { setMode(mode === "signup" ? "signin" : "signup"); setMsg(null); }}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center" },
  inner: { paddingHorizontal: space.xl, gap: space.sm },
  input: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
});
