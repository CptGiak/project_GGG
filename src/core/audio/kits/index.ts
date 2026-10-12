/** every champion's ability sounds, merged into the SFX catalogue (names "<champion>.<sound>") */
import type { SfxDef } from '../layers';
import { AKALI } from './akali';
import { ELISABBAT } from './elisabbat';
import { KAISER } from './kaiser';
import { LOCKE } from './locke';
import { NOVA } from './nova';
import { POOH } from './pooh';
import { QIYANA } from './qiyana';
import { REX } from './rex';
import { SERA } from './sera';

export const KIT_SFX: Record<string, SfxDef> = { ...KAISER, ...NOVA, ...REX, ...SERA, ...AKALI, ...QIYANA, ...LOCKE, ...POOH, ...ELISABBAT };
