import id from "./locales/id.json";
import en from "./locales/en.json";

const locales: Record<string, any> = {
    "id": id,
    "en": en
};

// Fungsi pembantu untuk mengambil teks bahasa
export function t(key: string, lang: string = "id"): string {
    const locale = locales[lang] || locales["id"];
    return locale[key] || locales["id"][key] || key;
}