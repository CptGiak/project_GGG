import type { ChampionId } from '../../../shared/champions';
import type { Kit } from '../../game/types';
import { AkaliKit } from './akaliKit';
import { KaiserKit } from './kaiserKit';
import { LockeKit } from './lockeKit';
import { NovaKit } from './novaKit';
import { PoohKit } from './poohKit';
import { QiyanaKit } from './qiyanaKit';
import { RexKit } from './rexKit';
import { SeraKit } from './seraKit';

export function createKit(id: ChampionId): Kit {
  switch (id) {
    case 'nova':
      return new NovaKit();
    case 'rex':
      return new RexKit();
    case 'sera':
      return new SeraKit();
    case 'akali':
      return new AkaliKit();
    case 'qiyana':
      return new QiyanaKit();
    case 'locke':
      return new LockeKit();
    case 'pooh':
      return new PoohKit();
    case 'kaiser':
    default:
      return new KaiserKit();
  }
}
