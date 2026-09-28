import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { PinInput } from "@/components/base/input/pin-input";
import {
  SignInCancelled,
  addAccountWithGoogle,
  emailCodesEnabled,
  requestEmailCode,
  verifyEmailCode,
  type Account,
  type PendingCode,
} from "@/lib/accounts";

/**
 * Sign-in screen: add an account to this browser. Google (a popup, no
 * password), plus an emailed one-time code when the server can send email.
 * Reused whenever Workspace needs an account: first run, an expired session,
 * or "add another account". Signing in for the first time creates the account;
 * Workspace then starts onboarding.
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
  const [emailOffered, setEmailOffered] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<PendingCode | null>(null);
  const [code, setCode] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void emailCodesEnabled().then((on) => live && setEmailOffered(on));
    return () => {
      live = false;
    };
  }, []);

  // Must run straight from the click: browsers only allow a popup opened
  // synchronously in response to user input.
  const onGoogle = () => {
    setError(null);
    setGoogleBusy(true);
    addAccountWithGoogle()
      .then(onSignedIn)
      .catch((err: Error) => {
        if (!(err instanceof SignInCancelled)) setError(err.message);
      })
      .finally(() => setGoogleBusy(false));
  };

  const onRequestCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || emailBusy) return;
    setError(null);
    setEmailBusy(true);
    try {
      setPending(await requestEmailCode(email));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEmailBusy(false);
    }
  };

  const onVerify = async (value: string) => {
    if (!pending || value.length < 6 || verifyBusy) return;
    setError(null);
    setVerifyBusy(true);
    try {
      onSignedIn(await verifyEmailCode(pending, value));
    } catch (err) {
      setError((err as Error).message);
      setCode("");
    } finally {
      setVerifyBusy(false);
    }
  };

  const differentEmail = () => {
    setPending(null);
    setCode("");
    setError(null);
  };

  const subtitle = pending
    ? `Enter the 6-digit code sent to ${pending.email}.`
    : (reason ?? "Sign in to open the editor.");

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-primary px-4 py-12">
      <div className="w-full max-w-[400px] rounded-2xl border border-secondary bg-secondary px-6 py-9 shadow-2xl ring-1 ring-primary sm:px-8">
        <header className="text-center">
          <h1 className="font-title text-[28px] leading-tight text-primary">Propaganda</h1>
          <p className="mx-auto mt-2 max-w-[30ch] text-sm text-balance text-tertiary">{subtitle}</p>
        </header>

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-error_subtle bg-error-primary px-3.5 py-2.5 text-center text-sm text-error-primary"
          >
            {error}
          </p>
        )}

        {!pending ? (
          <div className="mt-8">
            <Button
              size="lg"
              color="primary"
              className="w-full"
              iconLeading={<GoogleMark className="size-5 shrink-0" />}
              isDisabled={googleBusy}
              onClick={onGoogle}
            >
              {googleBusy ? "Waiting for Google…" : "Continue with Google"}
            </Button>

            {emailOffered && (
              <>
                <div className="my-6 flex items-center gap-3" aria-hidden="true">
                  <div className="h-px flex-1 bg-border-secondary" />
                  <span className="text-xs tracking-widest text-quaternary uppercase">or</span>
                  <div className="h-px flex-1 bg-border-secondary" />
                </div>

                <form className="space-y-3" onSubmit={(e) => void onRequestCode(e)}>
                  <Input
                    size="lg"
                    type="email"
                    name="email"
                    autoComplete="email"
                    aria-label="Email address"
                    placeholder="you@example.com"
                    value={email}
                    onChange={setEmail}
                    isDisabled={emailBusy}
                  />
                  <Button
                    type="submit"
                    size="lg"
                    color="secondary"
                    className="w-full"
                    isDisabled={emailBusy || !email.trim()}
                  >
                    {emailBusy ? "Sending…" : "Email me a code"}
                  </Button>
                </form>
              </>
            )}
          </div>
        ) : (
          <div className="mt-8 space-y-6">
            <PinInput size="xxs" disabled={verifyBusy} invalid={Boolean(error)} className="items-center">
              <PinInput.Group
                autoFocus
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

            <div className="space-y-3">
              <Button
                size="lg"
                color="primary"
                className="w-full"
                isDisabled={verifyBusy || code.length < 6}
                onClick={() => void onVerify(code)}
              >
                {verifyBusy ? "Verifying…" : "Continue"}
              </Button>
              <div className="text-center">
                <Button size="sm" color="link-gray" onClick={differentEmail}>
                  Use a different email
                </Button>
              </div>
            </div>
          </div>
        )}

        {onCancel ? (
          <div className="mt-8 border-t border-secondary pt-5 text-center">
            <Button size="sm" color="link-gray" onClick={onCancel}>
              Back
            </Button>
          </div>
        ) : (
          !pending && (
            <p className="mt-8 text-center text-xs text-quaternary">New here? Signing in creates your account.</p>
          )
        )}
      </div>
    </div>
  );
}

/** Google's "G", in its own colours (they stay put on light and dark buttons). */
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 262" aria-hidden="true" className={className}>
      <path
        fill="#4285F4"
        d="M255.9 133.5c0-10.8-.9-18.6-2.8-26.7H130.6v48.4h71.9a64 64 0 0 1-26.7 42.4l-.2 1.6 38.7 30 2.7.3c24.7-22.8 38.9-56.3 38.9-96"
      />
      <path
        fill="#34A853"
        d="M130.6 261.1c35.2 0 64.8-11.6 86.4-31.6l-41.2-32a76 76 0 0 1-45.2 13.1 79 79 0 0 1-74.3-54.2l-1.5.1-40.3 31.2-.6 1.5A131 131 0 0 0 130.6 261"
      />
      <path fill="#FBBC05" d="M56.3 156.4a80 80 0 0 1-.2-51.7V103L15.3 71.3l-1.4.6a131 131 0 0 0 0 117.3z" />
      <path
        fill="#EB4335"
        d="M130.6 50.5c24.5 0 41 10.6 50.4 19.4L218 34c-22.8-21-52.2-34-87.4-34C79.5 0 35.4 29.3 13.9 72l42.2 32.7a79 79 0 0 1 74.5-54.2"
      />
    </svg>
  );
}
