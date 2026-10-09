import { kitOf, type ChampionId } from '../../../shared/champions';
import type { Kit } from '../../game/types';
import { KaiserKit } from './kaiserKit';
import { NovaKit } from './novaKit';
import { RexKit } from './rexKit';
import { SeraKit } from './seraKit';

export function createKit(id: ChampionId): Kit {
  // imported champions play with the kit of an original one (own data: name, colours)
  switch (kitOf(id)) {
    case 'nova':
      return new NovaKit(id);
    case 'rex':
      return new RexKit();
    case 'sera':
      return new SeraKit();
    case 'kaiser':
    default:
      return new KaiserKit(id);
  }
}
