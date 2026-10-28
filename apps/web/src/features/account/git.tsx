import type { SettingsProps } from "./settings";
import { Connections } from "./connections";
import { DropboxSettings } from "./dropbox-policy";
import { Credentials } from "./credentials";
import { PreferenceForm } from "./preferences";
import "./integrations.css";

export function GitSettings(props: SettingsProps) {
  return <>
    <Connections {...props} />
    <DropboxSettings {...props} />
    <Credentials {...props} />
    <PreferenceForm {...props} tab="git" />
  </>;
}
