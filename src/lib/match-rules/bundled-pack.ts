/**
 * Bundled default match rule pack (offline). Remote overlay merges on top later.
 *
 * Note: JS `\b` is ASCII-only — Cyrillic tokens use edge classes instead.
 */
import type { MatchRulePack } from '@/lib/match-rules/types';

export const BUNDLED_MATCH_RULES_VERSION = '1.0.0';

/** Left edge for mixed Latin/Cyrillic tokens */
const L = String.raw`(?:^|[\s,.;:«"(«\-–—])`;
/** Right edge */
const R = String.raw`(?=$|[\s,.;:»")\-–—])`;

export const BUNDLED_MATCH_RULE_PACK: MatchRulePack = {
  rulesVersion: BUNDLED_MATCH_RULES_VERSION,
  roleHardBlockMinConfidence: 0.55,
  roleLexicon: [
    {
      id: 'controller',
      role: 'accessory',
      pattern: String.raw`${L}(?:dual\s*sense|dualshock|геймпад|джойстик|контроллер|controller|gamepad)${R}`,
      flags: 'i',
      typeNoun: 'контроллер',
    },
    {
      id: 'phone_case',
      role: 'accessory',
      pattern: String.raw`${L}(?:чехол|case|защитн\w*\s+(?:стекл|плёнк|пленк)|плёнк\w*|пленк\w*)${R}`,
      flags: 'i',
      typeNoun: 'чехол',
    },
    {
      id: 'cartridge',
      role: 'consumable',
      pattern: String.raw`${L}(?:картридж|тонер|чернил\w*|cartridge|toner)${R}`,
      flags: 'i',
      typeNoun: 'картридж',
    },
    {
      id: 'vacuum_filter',
      role: 'part',
      pattern: String.raw`${L}(?:фильтр|hepa|filter)${R}`,
      flags: 'i',
      typeNoun: 'фильтр',
    },
    {
      id: 'brush_head',
      role: 'consumable',
      pattern: String.raw`${L}(?:насадк\w*|brush\s*head)${R}`,
      flags: 'i',
      typeNoun: 'насадка',
    },
    {
      id: 'tool_battery',
      role: 'part',
      pattern: String.raw`${L}(?:аккумулятор|батаре\w*|battery)${R}`,
      flags: 'i',
      typeNoun: 'аккумулятор',
    },
    {
      id: 'coffee_capsules',
      role: 'supply',
      pattern: String.raw`${L}(?:капсул\w*|capsules?)${R}`,
      flags: 'i',
      typeNoun: 'капсулы',
    },
    {
      id: 'pet_food',
      role: 'supply',
      pattern: String.raw`${L}(?:корм\s+для|wet\s+food|dry\s+food)`,
      flags: 'i',
      typeNoun: 'корм',
    },
    {
      id: 'eye_patches',
      role: 'consumable',
      pattern: String.raw`${L}(?:патч\w*|patches?)${R}`,
      flags: 'i',
      typeNoun: 'патчи',
    },
    {
      id: 'cable_charger',
      role: 'accessory',
      pattern: String.raw`${L}(?:кабель|зарядк\w*|зарядн\w*|cable|charger)${R}`,
      flags: 'i',
    },
  ],
  hostFamilies: [
    {
      family: 'console',
      pattern: String.raw`${L}(?:playstation|ps\s*[45]|xbox(?:\s+series)?|nintendo\s+switch|steam\s+deck|игровая\s+приставк\w*|приставк\w*)${R}`,
      flags: 'i',
      hostCapture: String.raw`${L}((?:playstation\s*[45]|ps\s*[45]|xbox\s+series\s*[xs]?|nintendo\s+switch(?:\s*(?:oled|lite))?|steam\s+deck))${R}`,
      hostCaptureFlags: 'i',
    },
    {
      family: 'phone',
      pattern: String.raw`${L}(?:iphone|galaxy\s*[samz]\d|смартфон|телефон|redmi\s*(?:note\s*)?\d|xiaomi\s+\d)`,
      flags: 'i',
      hostCapture: String.raw`${L}((?:iphone\s*\d{1,2}(?:\s*(?:pro\s*max|pro|plus|mini))?|galaxy\s*[samz]\s*\d{1,2}(?:\s*(?:ultra|plus|fe))?|redmi\s*(?:note\s*)?\d{1,2}))${R}`,
      hostCaptureFlags: 'i',
    },
    {
      family: 'printer',
      pattern: String.raw`${L}(?:принтер|мфу|laserjet|deskjet|officejet|epson|brother|printer)${R}`,
      flags: 'i',
      hostCapture: String.raw`${L}((?:laserjet|deskjet|officejet|принтер)[\w\s-]{0,24})`,
      hostCaptureFlags: 'i',
    },
    {
      family: 'vacuum',
      pattern: String.raw`${L}(?:пылесос|vacuum|dyson\s*v\d+|roborock|dreame)${R}`,
      flags: 'i',
      hostCapture: String.raw`${L}((?:dyson\s*v\d+\w*|roborock\s*s?\d+\w*|dreame\s*\w+))${R}`,
      hostCaptureFlags: 'i',
    },
    {
      family: 'toothbrush',
      pattern: String.raw`${L}(?:oral[\s-]?b|зубн\w*\s+щ[её]тк\w*|electric\s+toothbrush)`,
      flags: 'i',
      hostCapture: String.raw`${L}((?:oral[\s-]?b[\w\s-]{0,16}|зубн\w*\s+щ[её]тк\w*))`,
      hostCaptureFlags: 'i',
    },
    {
      family: 'power_tool',
      pattern: String.raw`${L}(?:makita|bosch|дрель|шурупов\w*|перфоратор|болгарк\w*)${R}`,
      flags: 'i',
      hostCapture: String.raw`${L}((?:makita|bosch|metabo)[\w\s-]{0,20})${R}`,
      hostCaptureFlags: 'i',
    },
    {
      family: 'coffee',
      pattern: String.raw`${L}(?:nespresso|кофемашин\w*|кофеварк\w*|coffee\s*machine|espresso)${R}`,
      flags: 'i',
      hostCapture: String.raw`${L}((?:nespresso|кофемашин\w*|кофеварк\w*))${R}`,
      hostCaptureFlags: 'i',
    },
    {
      family: 'pet',
      pattern: String.raw`${L}(?:кошк\w*|котят\w*|собак\w*|щенк\w*|cat|dog|kitten|puppy)${R}`,
      flags: 'i',
    },
  ],
  entityHints: [
    {
      id: 'dualsense',
      entity: 'DualSense',
      pattern: String.raw`\bdual\s*sense\b`,
      flags: 'i',
      role: 'accessory',
      hostFamily: 'console',
      typeNoun: 'контроллер',
    },
    {
      id: 'dualshock',
      entity: 'DualShock',
      pattern: String.raw`\bdualshock\b`,
      flags: 'i',
      role: 'accessory',
      hostFamily: 'console',
      typeNoun: 'контроллер',
    },
    {
      id: 'nespresso_capsules',
      entity: 'Nespresso',
      pattern: String.raw`(?:капсул\w*.{0,48}nespresso|nespresso.{0,48}капсул\w*)`,
      flags: 'i',
      role: 'supply',
      hostFamily: 'coffee',
      typeNoun: 'капсулы',
    },
  ],
  marketingStrip: [
    { id: 'wireless', pattern: String.raw`(?:беспроводн\w*|wireless)`, flags: 'i' },
    { id: 'original', pattern: String.raw`(?:оригинальн\w*|original|оригинал)`, flags: 'i' },
    { id: 'new', pattern: String.raw`(?:новый|новая|новое|new)`, flags: 'i' },
    {
      id: 'colors',
      pattern: String.raw`(?:белый|черный|чёрный|синий|красный|серый|white|black|blue|red|gray|grey)`,
      flags: 'i',
    },
  ],
  roleRelations: [
    {
      id: 'dependent_vs_host_primary',
      refRoles: ['accessory', 'consumable', 'part', 'supply'],
      candRoles: ['primary'],
      requireSameFamily: true,
      hardBlock: true,
    },
    {
      id: 'host_primary_vs_dependent',
      refRoles: ['primary'],
      candRoles: ['accessory', 'consumable', 'part', 'supply'],
      requireSameFamily: true,
      hardBlock: true,
    },
  ],
};
