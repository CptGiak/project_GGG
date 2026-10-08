/** Arena ids and spawn points, shared so the server can place respawns. */
export interface ArenaSpawn {
  pos: [number, number, number];
  /** point the spawn faces */
  look: [number, number];
}

export interface ArenaMeta {
  id: string;
  name: string;
  subtitle: string;
  colors: [string, string];
  spawns: ArenaSpawn[];
}

export const ARENA_META: ArenaMeta[] = [
  {
    id: 'neon_city',
    name: 'SHIBUYA VELVET',
    subtitle: 'Incrocio cremisi sotto la luna',
    colors: ['#ff2440', '#1a0710'],
    spawns: [
      { pos: [-28, 0.5, -28], look: [0, 0] },
      { pos: [28, 0.5, 28], look: [0, 0] },
      { pos: [28, 0.5, -28], look: [0, 0] },
      { pos: [-28, 0.5, 28], look: [0, 0] },
      { pos: [0, 0.5, -66], look: [0, 0] },
      { pos: [0, 0.5, 66], look: [0, 0] },
      { pos: [66, 0.5, 0], look: [0, 0] },
      { pos: [-66, 0.5, 0], look: [0, 0] },
    ],
  },
  {
    id: 'stage',
    name: 'TRUE NOTE ARENA',
    subtitle: 'Il concerto più letale del mondo',
    colors: ['#b44bff', '#ffc94a'],
    spawns: [
      { pos: [0, 2.8, 36], look: [0, 0] },
      { pos: [0, 0.5, -40], look: [0, 0] },
      { pos: [40, 0.5, 0], look: [0, 0] },
      { pos: [-40, 0.5, 0], look: [0, 0] },
      { pos: [28, 0.5, -28], look: [0, 0] },
      { pos: [-28, 0.5, -28], look: [0, 0] },
      { pos: [30, 0.5, 30], look: [0, 0] },
      { pos: [-30, 0.5, 30], look: [0, 0] },
    ],
  },
  {
    id: 'tartarus',
    name: 'MIDNIGHT TARTARUS',
    subtitle: "L'ora nascosta tra le torri sospese",
    colors: ['#3cffb4', '#08201c'],
    spawns: [
      { pos: [0, 12.5, 34], look: [0, 0] },
      { pos: [0, 12.5, -34], look: [0, 0] },
      { pos: [34, 12.5, 0], look: [0, 0] },
      { pos: [-34, 12.5, 0], look: [0, 0] },
      { pos: [48, 0.5, 48], look: [0, 0] },
      { pos: [-48, 0.5, -48], look: [0, 0] },
      { pos: [48, 0.5, -48], look: [0, 0] },
      { pos: [-48, 0.5, 48], look: [0, 0] },
    ],
  },
];

export function arenaMeta(id: string): ArenaMeta {
  return ARENA_META.find((a) => a.id === id) ?? ARENA_META[0];
}
