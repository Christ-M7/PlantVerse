import { NextResponse } from "next/server";

export const revalidate = 900; // 15-min edge-friendly cache

interface WeatherOut {
  success: boolean;
  cityFa: string;
  cityEn: string;
  temp: number;
  condition: "sunny" | "cloudy" | "partly" | "rainy" | "snowy";
  humidity: number;
  wind: number;
  tipsFa: string[];
  tipsEn: string[];
  source: "live" | "fallback";
}

/** GET /api/weather — Tehran weather for smart care tips */
export async function GET() {
  const live = await fetchLive();
  if (live) return NextResponse.json(live);
  return NextResponse.json(fallback());
}

async function fetchLive(): Promise<WeatherOut | null> {
  try {
    const res = await fetch("https://wttr.in/Tehran?format=j1", {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "PlantVerse/1.0" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const cur = data?.current_condition?.[0];
    if (!cur) return null;
    const temp = Math.round(Number(cur.temp_C));
    const humidity = Math.round(Number(cur.humidity));
    const wind = Math.round(Number(cur.windspeedKmph));
    const code = Number(cur.weatherCode);
    const condition: WeatherOut["condition"] =
      code >= 227 && code <= 323 ? "snowy"
      : [176, 263, 266, 293, 296, 299, 302, 305, 308, 353, 356, 359].includes(code) ? "rainy"
      : [113].includes(code) ? "sunny"
      : [116].includes(code) ? "partly"
      : "cloudy";

    const hot = temp >= 30, dry = humidity <= 30, cold = temp <= 8;
    return {
      success: true,
      cityFa: "تهران", cityEn: "Tehran",
      temp, condition, humidity, wind,
      tipsFa: hot
        ? [
            dry
              ? "هوا گرم و خشک است؛ گیاهان رطوبت بیشتری از دست می‌دهند — آبیاری عمیق در ساعات خنک صبح انجام دهید."
              : "هوای گرم است؛ آبیاری صبح زود و غبارپاشی برگ‌ها را فراموش نکنید.",
            "گلدان‌ها را دور از پنجره‌های آفتاب‌سوز جابه‌جا کنید.",
          ]
        : cold
          ? ["هوا سرد است؛ گیاهان را از پنجره‌های سرد و جریان هوای سرد دور نگه دارید و آبیاری را کاهش دهید."]
          : ["شرایط هوا برای بیشتر گیاهان ایده‌آل است؛ روز خوبی برای کوددهی و هرس سبک است."],
      tipsEn: hot
        ? [
            dry
              ? "Hot & dry air dehydrates plants fast — deep-water in the cool morning hours."
              : "It's hot today — water early and mist the foliage.",
            "Move pots away from scorching windows.",
          ]
        : cold
          ? ["Cold snap — keep plants away from chilly windows and reduce watering."]
          : ["Great conditions for most plants — a good day for feeding and light pruning."],
      source: "live",
    };
  } catch {
    return null;
  }
}

function fallback(): WeatherOut {
  return {
    success: true,
    cityFa: "تهران", cityEn: "Tehran",
    temp: 37, condition: "sunny", humidity: 18, wind: 14,
    tipsFa: [
      "امروز هوا گرم و خشک است؛ گیاهان رطوبت بیشتری از دست می‌دهند — آبیاری عمیق در ساعات خنک انجام دهید.",
      "از غبارپاشی صبحگاهی برای برگ‌های حساس مثل کالاتیا استفاده کنید.",
    ],
    tipsEn: [
      "Hot, dry day — plants lose moisture fast; deep-water in the cool hours.",
      "Morning misting helps sensitive foliage like Calathea.",
    ],
    source: "fallback",
  };
}
