import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { endpoints } from "@quire/contracts";
import { BrandMark, Button, Field } from "../../ui";
import { mutationHeaders, Notice, unwrap, useAction, value } from "./shared";
import type { AccountPageProps } from "./shared";
import { StartingPoint } from "./starting-point";
import { ProviderOptions, useAuthOptions } from "./auth-options";
import { PasswordCreationField } from "./PasswordStrength";
import { onboardingScreen, rememberOnboardingScreen } from "./onboarding-progress";
import { authPath, billingReturnPath, clearBillingReturn, useAuthReturn } from "./onboarding-return";

function AuthShell({ signup = false, children }: { readonly signup?: boolean; readonly children: ReactNode }) {
  return <div className={`account-auth${signup ? " account-signup" : ""}`}>
    <aside className="account-intro" aria-label="About Quire">
      <a href="/" aria-label="Quire home"><BrandMark /></a>
      <div className="account-intro__body">
        <p className="account-statement">{signup ? "Your first paper starts here." : <>Write LaTeX together.<br />Version it like code.</>}</p>
        {signup ? <ol><li>Create your account</li><li>Verify your email</li><li>Pick a starting point</li></ol> : <>
          <div className="account-equation">z<sub>t+1</sub> = f<sub>θ</sub>(z<sub>t</sub>, a<sub>t</sub>) + ε<sub>t</sub></div>
          <ul><li>Source, split, visual and PDF views with SyncTeX</li><li>Real Git underneath: branch, diff, push to GitHub or GitLab</li><li>Your organization’s SSO, templates and TeX Live image</li></ul>
        </>}
      </div>
      <p>© 2026 Quire</p>
    </aside>
    <main className="account-auth__body"><div className="account-auth__form account-stack">{children}</div></main>
  </div>;
}
export function SignIn(props: AccountPageProps) {
  const action = useAction();
  const availability = useAuthOptions(props.client);
  const params = new URL(props.path, location.origin).searchParams;
  const requested = useAuthReturn(props.path, params.get("onboarding") === "1");
  const returnTo = requested ?? (params.get("onboarding") === "1" ? "/sign-up?step=start" : "/projects");
  function navigate(path: string) {
    if (billingReturnPath(path, location.origin)) clearBillingReturn();
    props.navigate(path);
  }
  return <AuthShell><div><h1>Sign in</h1><p className="account-muted">New here? <a href={authPath("/sign-up", requested)}>Create an account</a></p></div>
    <ProviderOptions client={props.client} availability={availability} returnTo={returnTo} onSessionChange={props.onSessionChange} navigate={navigate} organizationDiscovery /><div className="account-divider">or with email</div>
    {availability.options && !availability.options.passwordEnabled && <p className="account-muted">Password sign-in is disabled by this server. Use an enabled identity provider.</p>}
    <form className="account-form" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void action.run(async () => {
        unwrap(await props.client.call(endpoints.authLogin, { params: {}, query: {}, body: { email: value(form, "email"), password: value(form, "password") } }));
        await props.onSessionChange(); navigate(returnTo);
      });
    }}>
      <fieldset disabled={action.busy || !availability.options?.passwordEnabled}><Field label="Email" name="email" type="email" required autoComplete="email" placeholder="you@university.edu" />
        <div className="account-password">
          <Field label="Password" name="password" type="password" required autoComplete="current-password" />
          <a href="/reset-password" className="account-forgot" aria-label="Forgot your password?">Forgot?</a>
        </div>
        <Notice {...action} />
        <Button type="submit" variant="dark" busy={action.busy} className="account-submit">Sign in</Button>
      </fieldset>
    </form>
    <p className="account-legal">By continuing you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>
  </AuthShell>;
}
export function SignUp(props: AccountPageProps) {
  const params = new URL(props.path, location.origin).searchParams;
  const returnTo = useAuthReturn(props.path);
  const signInPath = authPath("/sign-in?onboarding=1", returnTo);
  const explicitStep = params.get("step") === "start" ? "start" : params.has("token") || params.get("step") === "verify" ? "verify"
    : params.get("step") === "create" ? "create" : null;
  const [resumedStep, setResumedStep] = useState<string>(onboardingScreen);
  const step = explicitStep ?? resumedStep;
  const action = useAction();
  const availability = useAuthOptions(props.client);
  useEffect(() => {
    if (explicitStep) return undefined;
    const controller = new AbortController();
    void props.client.call(endpoints.me, { params: {}, query: {}, body: undefined }, controller.signal).then(result => {
      if (!controller.signal.aborted && "data" in result) setResumedStep("start");
    }).catch((cause: unknown) => { if (!controller.signal.aborted && cause instanceof Error) action.setError(cause.message); });
    return () => controller.abort();
  }, [explicitStep, props.client]);
  return <AuthShell signup>
    {step === "start" ? <StartingPoint {...props} returnTo={returnTo} /> : step === "signin" ? <>
      <h1>Continue to sign in</h1><p>Sign in with your verified account to resume your starting point.</p>
      <a href={signInPath}>Continue to sign in</a>
      <a href={authPath("/sign-up?step=create", returnTo)} onClick={() => rememberOnboardingScreen("create")}>Create a different account</a>
    </> : step === "verify" ? <>
      <h1>Verify your email</h1><p>If registration can proceed, open the verification link in your email, or enter its token below.</p>
      <form className="account-form" onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void action.run(async () => {
          unwrap(await props.client.call(endpoints.authVerifyEmail, { params: {}, query: {}, body: { token: value(form, "token") } }));
          rememberOnboardingScreen("signin");
          props.navigate(signInPath);
        });
      }}>
        <Field label="Verification token" name="token" required defaultValue={params.get("token") ?? ""} autoComplete="one-time-code" />
        <Notice {...action} /><Button type="submit" variant="primary" busy={action.busy}>Verify email</Button>
      </form>
      <a href={signInPath}>Continue to sign in</a>
      <a href={authPath("/sign-up?step=create", returnTo)} onClick={() => rememberOnboardingScreen("create")}>Use a different email</a>
      <p className="account-muted">No message? Contact your server administrator to check mail delivery. This server has no resend endpoint.</p>
    </> : <>
      <div><h1>Create your account</h1><p>Already have one? <a href={authPath("/sign-in", returnTo)}>Sign in</a></p></div>
      {billingReturnPath(returnTo, location.origin) && <p>Verify your email and sign in to continue to your selected plan. Creating a project is optional.</p>}
      <ProviderOptions client={props.client} availability={availability} returnTo="/sign-up?step=start" onSessionChange={props.onSessionChange} navigate={props.navigate} /><div className="account-divider">or with email</div>
      {availability.options && !availability.options.registrationEnabled && <p>Account registration is disabled by this server.</p>}
      {availability.options && !availability.options.passwordEnabled && <p>Password registration is disabled. Choose an enabled identity provider.</p>}
      <form className="account-form" onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void action.run(async () => {
          const result = unwrap(await props.client.call(endpoints.authRegister, { params: {}, query: {}, body: { name: value(form, "name"), email: value(form, "email"), password: value(form, "password") }, headers: mutationHeaders() }));
          if (result.verificationRequired) {
            rememberOnboardingScreen("verify"); props.navigate(authPath("/sign-up?step=verify", returnTo));
          } else { await props.onSessionChange(); props.navigate(authPath("/sign-up?step=start", returnTo)); }
        });
      }}>
        <fieldset disabled={action.busy || !availability.options?.registrationEnabled || !availability.options.passwordEnabled}>
          <Field label="Full name" name="name" required autoComplete="name" />
          <Field label="Email" name="email" type="email" required autoComplete="email" />
          <PasswordCreationField label="Password" />
          <Notice {...action} /><Button type="submit" variant="primary" busy={action.busy}>Create account</Button>
        </fieldset>
      </form>
      <p className="account-muted">Account access follows your server’s policies. No payment is collected here.</p>
    </>}
  </AuthShell>;
}
export function ResetPassword(props: AccountPageProps) {
  const token = new URL(props.path, location.origin).searchParams.get("token");
  const [state, setState] = useState(token ? "confirm" : "request");
  const action = useAction();
  const availability = useAuthOptions(props.client);
  return <main className="account-reset"><a href="/" aria-label="Quire home"><BrandMark /></a><section className="account-reset__card account-stack">
    <h1>{state === "confirm" ? "Choose a new password" : state === "sent" ? "Check your inbox" : state === "done" ? "Password updated" : "Forgot your password?"}</h1>
    {state === "request" ? <><p>Enter your email and we’ll send a link to choose a new password.</p>
      <form className="account-form" onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void action.run(async () => { unwrap(await props.client.call(endpoints.passwordReset, { params: {}, query: {}, body: { email: value(form, "email") } })); setState("sent"); });
      }}>
        <Field label="Email" name="email" type="email" autoComplete="email" required disabled={!availability.options?.passwordEnabled} />
        <Notice {...action} /><Button type="submit" variant="primary" busy={action.busy} disabled={!availability.options?.passwordEnabled}>Send reset link</Button>
      </form><p className="account-muted">Use your organization’s identity provider to reset an SSO password.</p></>
      : state === "confirm" ? <form className="account-form" onSubmit={event => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        if (value(form, "password") !== value(form, "confirm")) { action.setError("Passwords do not match."); return; }
        void action.run(async () => { unwrap(await props.client.call(endpoints.passwordResetConfirm, { params: {}, query: {}, body: { token: token ?? "", password: value(form, "password") } })); await props.onSessionChange(); setState("done"); });
      }}>
        <PasswordCreationField label="New password" disabled={!availability.options?.passwordEnabled} />
        <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" minLength={12} required disabled={!availability.options?.passwordEnabled} />
        <Notice {...action} /><Button type="submit" variant="primary" busy={action.busy} disabled={!availability.options?.passwordEnabled}>Save new password</Button>
      </form>
      : state === "sent" ? <><p>If an account exists for that email, a reset link has been requested. Open the link from your email to continue.</p><Button onClick={() => setState("request")}>Use a different email</Button></>
      : <p>You can sign in with your new password now.</p>}
    {!availability.options && !availability.error && <p role="status">Loading password availability…</p>}
    {availability.error && <Notice error={availability.error} message="" />}
    {availability.options && !availability.options.passwordEnabled && <p>Password authentication is disabled. Reset your password with your configured identity provider.</p>}
    <a href="/sign-in">Back to sign in</a>
  </section></main>;
}
