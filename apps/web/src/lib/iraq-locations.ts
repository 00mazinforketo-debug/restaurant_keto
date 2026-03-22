export type IraqGovernorate = {
  name: string;
  districts: string[];
};

export type IraqLocationOption = {
  value: string;
  governorate: string;
  region: "kurdistan" | "iraq";
  kind: "governorate" | "district";
};

export type ParsedIraqAddress = {
  governorate: string;
  district: string;
  details: string;
};

const kurdistanGovernorateNames = new Set(["هەولێر", "سلێمانی", "دهۆک", "هەڵەبجە"]);

const rawGovernorates: IraqGovernorate[] = [
  {
    name: "هەولێر",
    districts: ["هەولێر ناوەند", "شەقڵاوە", "کۆیە", "سۆران", "چۆمان", "میرگەسوور", "ڕەواندوز", "خەبات", "بەحرکە", "کەوەڕگۆسک", "خەلیفان", "کەندیناوان"]
  },
  {
    name: "سلێمانی",
    districts: ["سلێمانی ناوەند", "چەمچەماڵ", "پێنجوێن", "دەربەندیخان", "دوکان", "ڕانیە", "پشدەر", "سەید سادق", "کەلار", "کفری", "تاق تاق", "باوەنوور", "سنگاو"]
  },
  {
    name: "دهۆک",
    districts: ["دهۆک ناوەند", "زاخۆ", "سێمێل", "ئامێدی", "ئاکرێ", "بەردەرەش", "شێخان", "مانگیش", "باتیفە", "فیشخابوور"]
  },
  {
    name: "هەڵەبجە",
    districts: ["هەڵەبجە ناوەند", "خورمال", "بیارە", "سیروان", "تەویلە", "بەمۆ"]
  },
  {
    name: "بەغدا",
    districts: ["ڕوسافە", "کەرخ", "سەدر", "ئەعظەمیە", "کازمیە", "مەنسور", "ڕاشد", "ئەبو غەریب", "محمودیە", "مەدائین", "تاجی", "سبع البور"]
  },
  {
    name: "نەینەوا",
    districts: ["مەوسڵ", "تەلعەفەر", "شەنگال", "حەمدانیە", "تەلکەیف", "شێخان", "مەخمور", "بەعاج", "حەترە", "قەیاروە"]
  },
  {
    name: "کەرکووک",
    districts: ["کەرکووک ناوەند", "حەویجە", "داقوق", "دەبس", "شوان", "تازەخورماتو"]
  },
  {
    name: "سەلاحەدین",
    districts: ["تکریت", "سامەڕا", "بەیجی", "شیرقات", "بەلەد", "دوجەیل", "توزخورماتو", "عەلم", "یثرب"]
  },
  {
    name: "دیالە",
    districts: ["بەعقوبە", "خالص", "مقدادیە", "بەلەدڕۆز", "خانەقین", "کفری", "جەلەولاء", "قەرە تپە", "مندلی"]
  },
  {
    name: "ئەنبار",
    districts: ["ڕەمادی", "فەلوجە", "هیت", "حدیثە", "قائم", "ڕاوە", "عانە", "ڕطبە", "عامریة الفلوجة"]
  },
  {
    name: "بابل",
    districts: ["حیلە", "محاویل", "مسیب", "هاشمیە", "قاسم", "کفل", "اسکندریە"]
  },
  {
    name: "کەربەلا",
    districts: ["کەربەلا ناوەند", "عین التمر", "هندیە", "حسینیە", "جدول الغربی"]
  },
  {
    name: "نەجەف",
    districts: ["نەجەف ناوەند", "کوفە", "مناذرە", "مشخاب", "حیدریە", "عباسیە"]
  },
  {
    name: "قادسیە",
    districts: ["دیوانیە", "شامیە", "عفک", "حمزە", "سومەر", "شنافیە"]
  },
  {
    name: "واسط",
    districts: ["کوت", "حی", "بدرە", "نعمانیە", "سوەیرە", "عزیزیە", "زبیدیە"]
  },
  {
    name: "ذی قار",
    districts: ["ناسریە", "شطرة", "سوق الشیوخ", "رفاعی", "غراف", "جبایش", "نصر", "فجر", "قلعة سکر"]
  },
  {
    name: "میسان",
    districts: ["عمارە", "علی الغربی", "علی الشرقي", "مجر الکبیر", "قلعة صالح", "کحلاء", "میمونە"]
  },
  {
    name: "مثنى",
    districts: ["سماوە", "رمیثە", "خضر", "سلمان", "سویـر"]
  },
  {
    name: "بەسرە",
    districts: ["بەسرە ناوەند", "زبیر", "ئەبو الخصیب", "قورنە", "شاطی العرب", "فاو", "مدینە", "هارثە", "سفوان"]
  }
];

export const iraqGovernorates = [...rawGovernorates].sort((left, right) => {
  const leftRank = kurdistanGovernorateNames.has(left.name) ? 0 : 1;
  const rightRank = kurdistanGovernorateNames.has(right.name) ? 0 : 1;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return left.name.localeCompare(right.name, "ku");
});

const districtDisplayValue = (governorate: string, district: string) =>
  district === governorate || district.includes(governorate) ? district : `${district} - ${governorate}`;

export const iraqLocationOptions: IraqLocationOption[] = iraqGovernorates.flatMap((entry) => {
  const region: IraqLocationOption["region"] = kurdistanGovernorateNames.has(entry.name) ? "kurdistan" : "iraq";
  return [
    {
      value: entry.name,
      governorate: entry.name,
      region,
      kind: "governorate" as const
    },
    ...entry.districts.map((district) => ({
      value: districtDisplayValue(entry.name, district),
      governorate: entry.name,
      region,
      kind: "district" as const
    }))
  ];
});

const governoratePrefix = "پارێزگا:";
const districtPrefix = "شار / ناحیە:";
const detailsPrefix = "وردەکاری ناونیشان:";

export const isKnownIraqLocation = (value: string) => iraqLocationOptions.some((entry) => entry.value === value.trim());

export const formatIraqAddress = ({ governorate, district, details }: ParsedIraqAddress) =>
  [
    governorate ? `${governoratePrefix} ${governorate}` : "",
    district ? `${districtPrefix} ${district}` : "",
    details ? `${detailsPrefix} ${details}` : ""
  ]
    .filter(Boolean)
    .join("\n");

export const parseIraqAddress = (value: string): ParsedIraqAddress => {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const governorateLine = lines.find((line) => line.startsWith(governoratePrefix));
  const districtLine = lines.find((line) => line.startsWith(districtPrefix));
  const detailsLine = lines.find((line) => line.startsWith(detailsPrefix));

  if (!governorateLine && !districtLine && !detailsLine) {
    return { governorate: "", district: "", details: value };
  }

  return {
    governorate: governorateLine?.slice(governoratePrefix.length).trim() ?? "",
    district: districtLine?.slice(districtPrefix.length).trim() ?? "",
    details: detailsLine?.slice(detailsPrefix.length).trim() ?? ""
  };
};
