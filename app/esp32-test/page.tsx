import type { Metadata } from "next";
import { Esp32LightTestConsole } from "@/components/Esp32LightTestConsole";

export const metadata: Metadata = {
  title: "ESP32 30-CH 燈光控制測試 | 一則光的訊息",
  description:
    "《一則光的訊息》30 道光數據 ESP32 硬體燈光控制測試與 5 座郵筒呼吸燈模擬分頁。",
};

export default function Esp32TestPage() {
  return <Esp32LightTestConsole />;
}
