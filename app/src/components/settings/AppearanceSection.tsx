import { useThemePref, type ThemePref } from "@/lib/theme";
import { Card, Row, Segmented } from "./ui";

/** Light or dark. System, the default, follows the device and changes with it. */
export function AppearanceSection() {
  const [pref, setPref] = useThemePref();
  return (
    <Card title="Appearance" description="This is kept on this device, not for the whole tenant.">
      <Row title="Theme" hint="System follows your device's light or dark setting.">
        <Segmented<ThemePref>
          label="Theme"
          value={pref}
          onChange={setPref}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Row>
    </Card>
  );
}
