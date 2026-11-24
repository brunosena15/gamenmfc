export interface CharacterDef {
  id: string;
  fileName: string;
  name: string;
  imageUrl: string;
  /** Som personalizado opcional ao marcar gol (ex: songs/songmau.m4a) */
  goalSoundUrl: string | null;
  /** Mecânica oculta: se true, o goleiro da IA sempre lê e defende 100% dos chutes */
  alwaysSaved: boolean;
}

// Lê dinamicamente todos os arquivos de imagem em gamenmfc/personagens
const characterModules = import.meta.glob<string>(
  '../personagens/*.{jpg,jpeg,png,webp}',
  { eager: true, import: 'default' }
);

// Lê dinamicamente sons personalizados de gol em gamenmfc/songs (ex: songmau.m4a)
const songModules = import.meta.glob<string>(
  '../songs/*.{m4a,mp3,ogg,wav}',
  { eager: true, import: 'default' }
);

const GOAL_SOUNDS_BY_ID: Record<string, string> = {};
for (const [path, url] of Object.entries(songModules)) {
  const fileName = path.split('/').pop() ?? path;
  const stem = fileName.replace(/\.[^.]+$/, '').toLowerCase();
  const normalizedId = stem.startsWith('song') ? stem.slice(4) : stem;
  if (normalizedId) {
    GOAL_SOUNDS_BY_ID[normalizedId] = url;
  }
}

// Mapeamento opcional de acentuação para exibir o nome bem formatado
const ACCENT_OVERRIDES: Record<string, string> = {
  bolivia: 'Bolívia',
};

function formatCharacterName(stem: string): string {
  const lower = stem.toLowerCase();
  if (ACCENT_OVERRIDES[lower]) {
    return ACCENT_OVERRIDES[lower];
  }
  return stem
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

let goalkeeperImageUrl: string | null = null;

export const CHARACTERS: CharacterDef[] = Object.entries(characterModules)
  .reduce<CharacterDef[]>((list, [path, imageUrl]) => {
    const fileName = path.split('/').pop() ?? path;
    const stem = fileName.replace(/\.[^.]+$/, '');
    const id = stem.toLowerCase();

    // personagens/goleiro.jpg é usado como o goleiro da IA, não como batedor selecionável
    if (id === 'goleiro') {
      goalkeeperImageUrl = imageUrl;
      return list;
    }

    list.push({
      id,
      fileName,
      name: formatCharacterName(stem),
      imageUrl,
      goalSoundUrl: GOAL_SOUNDS_BY_ID[id] ?? null,
      // Regra especial oculta: personagens/caus.jpg é sempre defendido pelo goleiro
      alwaysSaved: id === 'caus',
    });
    return list;
  }, [])
  .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

export const GOALKEEPER_IMAGE_URL: string | null = goalkeeperImageUrl;
