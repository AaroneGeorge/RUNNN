import { useState } from 'react';
import { Download, FlaskConical, Lock, Route as RouteIcon, Smartphone, Volume2, Vibrate, Zap } from 'lucide-react';
import { getSettings, setSettings, type Settings } from '../lib/storage.ts';
import { beep, unlockAudio, vibrate } from '../lib/sound.ts';
import { isStandalone, useInstall } from '../lib/install.ts';
import { IconTile, Segmented, SwitchRow, TopBar } from '../components/ui.tsx';
import { applyTheme } from '../lib/theme.ts';

export function SettingsPage() {
  const [s, setS] = useState<Settings>(getSettings);
  const inst = useInstall();
  const update = (next: Settings) => {
    setS(next);
    setSettings(next);
  };
  const installed = isStandalone();
  return (
    <div className="page">
      <TopBar title="Settings" />

      <h2 className="label">Appearance</h2>
      <div className="mb-7">
        <Segmented
          label="Appearance"
          value={s.theme}
          onChange={(theme) => {
            update({ ...s, theme });
            applyTheme(theme);
          }}
          options={[
            { value: 'system', label: 'Phone setting' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </div>

      <h2 className="label">In the game</h2>
      <div className="card mb-3 divide-y divide-line">
        <SwitchRow icon={<Volume2 size={18} />} tone="text-ink" title="Sound" desc="Radar blips and alert chimes." checked={s.sound} onChange={(v) => update({ ...s, sound: v })} />
        <SwitchRow
          icon={<Vibrate size={18} />}
          tone="text-ink"
          title="Vibration"
          desc="Buzz when danger is close or you get tagged (Android)."
          checked={s.vibrate}
          onChange={(v) => update({ ...s, vibrate: v })}
        />
        <SwitchRow
          icon={<RouteIcon size={18} />}
          tone="text-ink"
          title="My run map (beta)"
          desc="After each game, see the route you ran. Kept on this phone only, never sent to the game."
          checked={s.runMap}
          onChange={(v) => update({ ...s, runMap: v })}
        />
        <SwitchRow
          icon={<FlaskConical size={18} />}
          tone="text-gold"
          title="Test mode"
          desc="Fake GPS: move by tapping the map. For trying games on a laptop."
          checked={s.simGps}
          onChange={(v) => update({ ...s, simGps: v })}
        />
      </div>
      <button
        className="btn-ghost mb-7 w-full"
        onClick={() => {
          unlockAudio();
          beep(880, 150);
          vibrate([100, 50, 100]);
        }}
      >
        <Zap size={18} className="text-brand" /> Test sound &amp; buzz
      </button>

      <h2 className="label">App</h2>
      <div className="card mb-7 divide-y divide-line">
        <div className="flex items-center gap-3 p-4">
          <IconTile tone="text-brand">{installed ? <Smartphone size={18} /> : <Download size={18} />}</IconTile>
          <div className="min-w-0 flex-1">
            <div className="font-bold leading-tight">{installed ? 'Installed' : 'Install the app'}</div>
            <div className="mt-0.5 text-sm leading-snug text-dim">
              {installed
                ? "You're using the home-screen app."
                : inst.canPrompt
                  ? 'Full screen and one tap from your home screen.'
                  : inst.ios
                    ? 'Safari: Share, then Add to Home Screen.'
                    : 'Browser menu ⋮, then Add to Home screen.'}
            </div>
          </div>
          {!installed && inst.canPrompt && (
            <button className="btn-brand btn-sm" onClick={() => inst.install()}>
              Install
            </button>
          )}
        </div>
        <div className="flex gap-3 p-4">
          <IconTile tone="text-ink">
            <Lock size={18} />
          </IconTile>
          <div className="min-w-0 flex-1">
            <div className="font-bold leading-tight">Privacy</div>
            <div className="mt-0.5 text-sm leading-snug text-dim">
              Your location goes to the game server only while you're in a game, and is never stored. Profiles hold a name and your game stats.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
