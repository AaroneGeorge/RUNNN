import { useNavigate } from 'react-router';
import { Button, Card, Page, Section, Segmented, Toggle } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { cue } from '../lib/sound.ts';
import { setOrganiser, setSettings, useOrganiser, useSettings } from '../lib/storage.ts';

export function Settings() {
  const s = useSettings();
  const org = useOrganiser();
  const nav = useNavigate();

  return (
    <Page title="Settings" back>
      <Section title="Feel">
        <Card className="py-1">
          <Toggle
            checked={s.sound}
            onChange={(v) => {
              setSettings({ sound: v });
              if (v) setTimeout(() => cue('caught'), 50);
            }}
            label="Sound"
            help="Radar beeps and game cues."
          />
          <Toggle
            checked={s.vibrate}
            onChange={(v) => {
              setSettings({ vibrate: v });
              if (v) navigator.vibrate?.(80);
            }}
            label="Vibration"
            help="Caught, converted, out of bounds, round over."
          />
        </Card>
      </Section>

      <Section title="Theme">
        <Segmented
          value={s.theme}
          onChange={(theme) => setSettings({ theme })}
          options={[
            { value: 'system', label: 'Auto' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
        <p className="mt-2 px-1 text-xs text-dim">Light is easier to read in bright sun.</p>
      </Section>

      <Section title="Testing">
        <Card className="py-1">
          <Toggle
            checked={s.gpsTest}
            onChange={(v) => setSettings({ gpsTest: v })}
            label="GPS test mode"
            help="Ignore real GPS; tap the map in a game to move. For trying rounds from a desk."
          />
        </Card>
      </Section>

      <Section title="Account">
        <Card className="grid gap-2">
          {org ? (
            <Button
              variant="secondary"
              block
              onClick={async () => {
                await api('/organiser/logout', { method: 'POST', body: {} }).catch(() => {});
                setOrganiser(null);
              }}
            >
              Sign out organiser {org.username}
            </Button>
          ) : (
            <Button variant="secondary" block onClick={() => nav('/welcome')}>
              Organiser sign-in
            </Button>
          )}
          <Button variant="ghost" block onClick={() => (setSettings({ seenWelcome: false }), nav('/welcome'))}>
            Show the intro again
          </Button>
        </Card>
      </Section>
    </Page>
  );
}
