export interface OfficialDepartmentConfig {
  code: string;
  name: string;
  responsibleName?: string;
  description?: string;
}

export const OFFICIAL_DEPARTMENTS: OfficialDepartmentConfig[] = [
  { code: '01', name: 'Генеральный директор', description: 'Bosh direktor devoni' },
  { code: '02', name: 'Директор', responsibleName: 'Мирджалалов Шерзод Шахабеддинович', description: 'Direktor' },
  { code: '03', name: 'Финансы', responsibleName: 'Содиқов Ш', description: 'Moliya bo\'limi' },
  { code: '04', name: 'Зам.ген.директора по управлению персоналом', responsibleName: 'Убайдуллаева М', description: 'Kadrlar boshqaruvi va HR bo\'yicha o\'rinbosar' },
  { code: '05', name: 'Отдел по продажам маркетингу и PR', description: 'Sotuv, marketing va PR bo\'limi' },
  { code: '06', name: 'Ахо', responsibleName: 'Юлдашев А.А', description: 'Ma\'muriy-xo\'jalik bo\'limi (AXO)' },
  { code: '07', name: 'Реклама', responsibleName: 'Ш.Хамрокулов', description: 'Reklama bo\'limi' },
  { code: '08', name: 'Зам.ген.директора по правовым вопросам', responsibleName: 'Хасанов Акмал Дехконович', description: 'Huquqiy masalalar bo\'yicha o\'rinbosar (Yuridik)' },
  { code: '08/1', name: 'Зам.ген.директора по правовым вопросам (08/1)', responsibleName: 'Хасанов Акмал Дехконович', description: 'Huquqiy masalalar bo\'yicha o\'rinbosar (08/1)' },
  { code: '09', name: 'Логистика', responsibleName: 'Абдуллаев Ш', description: 'Logistika bo\'limi' },
  { code: '10', name: 'Бухгалтерия', responsibleName: 'Ибрагимов Я', description: 'Buxgalteriya' },
  { code: '11', name: 'Проект менеджеры', description: 'Loyiha menejerlari' },
  { code: '12', name: 'Координатор по охране имущества и безопасности', responsibleName: 'Мамаджанов Д', description: 'Xavfsizlik va mulk muhofazasi koordinatori' },
  { code: '13', name: 'Юнистрой', description: 'Yunistroy bo\'limi' },
  { code: '14', name: '14-бўлим', description: '14-bo\'lim (Zaxira)' },
  { code: '15', name: 'Газ, свет, сув', responsibleName: 'Қ.Ахмаджонов', description: 'Gaz, elektr, suv ta\'minoti' },
  { code: '16', name: 'Снабжение', responsibleName: 'Алимов Ж', description: 'Moddiy-texnik ta\'minot bo\'limi' },
  { code: '16/1', name: 'Снабжение (16/1)', responsibleName: 'Алимов Ж', description: 'Moddiy-texnik ta\'minot bo\'limi (16/1)' },
  { code: '17', name: 'ПТО', responsibleName: 'Ж.Чоршанбиев', description: 'Ishlab chiqarish-texnik bo\'limi (PTO)' },
];

/**
 * Bo'lim kodini matndan (masalan: "08 - Зам.ген...", "08/1...", "08") ajratib olish
 */
export function extractDepartmentCode(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const match = trimmed.match(/^([0-9]{2}(?:\/[0-9]+)?)/);
  if (match) return match[1];

  // Kod bo'yicha qidirish
  const byCode = OFFICIAL_DEPARTMENTS.find(d => d.code.toLowerCase() === trimmed.toLowerCase());
  if (byCode) return byCode.code;

  // Nom bo'yicha qidirish
  const byName = OFFICIAL_DEPARTMENTS.find(d => d.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) return byName.code;

  return null;
}
