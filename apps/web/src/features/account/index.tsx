import { useEffect } from "react";
import { SignIn, SignUp, ResetPassword } from "./auth";
import { Settings } from "./settings";
import { OfflineNotice } from "./shared";
import type { AccountPageProps } from "./shared";
import "./account.css";

export type { AccountPageProps } from "./shared";
export function AccountPage(props: AccountPageProps) {
  const path = new URL(props.path, location.origin).pathname;
  useEffect(() => { document.title = `${path.startsWith("/settings") ? "Account settings" : path === "/sign-up" ? "Create account" : path === "/reset-password" ? "Reset password" : "Sign in"} · Quire`; }, [path]);
  return <div className="account-page"><OfflineNotice />{path === "/sign-in" ? <SignIn {...props} /> : path === "/sign-up" || path === "/verify-email" ? <SignUp {...props} /> : path === "/reset-password" ? <ResetPassword {...props} /> : <Settings {...props} />}</div>;
}
