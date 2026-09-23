import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { PinInput } from "@/components/base/input/pin-input";
import {
  addAccountWithGoogle,
  requestEmailCode,
  verifyEmailCode,
  type Account,
  type PendingCode,
} from "@/lib/accounts";

/**
 * Sign-in screen: add an account to this browser. Two paths — Google (a popup,
 * no password) and an emailed one-time code. Reused whenever Workspace needs an
 * account: first run, an expired session, or "add another account".
 */
export function SignIn({
  reason,
  onCancel,
  onSignedIn,
}: {
  reason?: string;
  onCancel?: () => void;
  onSignedIn: (account: Account) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<PendingCode | null>(null);
  const [code, setCode] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);

  // Must be called straight from the click: browsers only allow a popup opened
  // synchronously in response to user input.
  const onGoogle = () => {
    setError(null);
    setGoogleBusy(true);
    addAccountWithGoogle()
      .then(onSignedIn)
      .catch((err: Error) => setError(err.message))
      .finally(() => setGoogleBusy(false));
  };

  const onRequestCode = async () => {
    setError(null);
    setEmailBusy(true);
    try {
      const p = await requestEmailCode(email);
      setPending(p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEmailBusy(false);
    }
  };

  const onVerify = async (value: string) => {
    if (!pending || value.length < 6) return;
    setError(null);
    setVerifyBusy(true);
    try {
      const account = await verifyEmailCode(pending, value);
      onSignedIn(account);
    } catch (err) {
      setError((err as Error).message);
      setCode("");
    } finally {
      setVerifyBusy(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-primary">
      <div className="w-[380px] max-w-[92vw] rounded-xl border border-secondary bg-secondary p-6 shadow-2xl ring-1 ring-primary">
        <h1 className="font-title text-xl text-primary">Propaganda</h1>
        <p className="mt-1 text-sm text-secondary">
          {reason ?? (pending ? `Enter the code sent to ${pending.email}.` : "Sign in to open the editor.")}
        </p>

        {error && <p className="mt-3 text-sm text-error-primary">{error}</p>}

        {!pending ? (
          <>
            <div className="mt-6 flex items-center justify-end">
              <Button size="sm" color="primary" isDisabled={googleBusy} onClick={onGoogle}>
                {googleBusy ? "Working…" : "Continue with Google"}
              </Button>
            </div>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-border-secondary" />
              <span className="text-xs uppercase tracking-widest text-quaternary">or</span>
              <div className="h-px flex-1 bg-border-secondary" />
            </div>

            <div className="space-y-3">
              <Input
                size="sm"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(v) => setEmail(v)}
                isDisabled={emailBusy}
              />
              <div className="flex items-center justify-end">
                <Button
                  size="sm"
                  color="secondary"
                  isDisabled={emailBusy || !email.trim()}
                  onClick={() => void onRequestCode()}
                >
                  {emailBusy ? "Sending…" : "Email me a code"}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-6 space-y-4">
            <PinInput size="xs" disabled={verifyBusy} invalid={Boolean(error)}>
              <PinInput.Group
                maxLength={6}
                value={code}
                onChange={(v) => {
                  setCode(v);
                  if (v.length === 6) void onVerify(v);
                }}
              >
                {Array.from({ length: 6 }).map((_, i) => (
                  <PinInput.Slot key={i} index={i} />
                ))}
              </PinInput.Group>
            </PinInput>

            <div className="flex items-center justify-between">
              <Button
                size="sm"
                color="link-gray"
                onClick={() => {
                  setPending(null);
                  setCode("");
                  setError(null);
                }}
              >
                Use a different email
              </Button>
              <Button size="sm" color="primary" isDisabled={verifyBusy || code.length < 6} onClick={() => void onVerify(code)}>
                {verifyBusy ? "Verifying…" : "Continue"}
              </Button>
            </div>
          </div>
        )}

        {onCancel && (
          <div className="mt-5 border-t border-secondary pt-4">
            <Button size="sm" color="tertiary" onClick={onCancel}>
              Back
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
