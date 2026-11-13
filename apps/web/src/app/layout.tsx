import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Sniglet } from "next/font/google";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "./globals.css";

const sniglet = Sniglet({ subsets: ["latin"], weight: "400", variable: "--font-sniglet", display: "swap" });

export const metadata: Metadata = {
  title: "ZenBook — Đặt lịch hẹn cho doanh nghiệp dịch vụ",
  description: "Trang đặt lịch riêng cho khách hàng và workspace quản lý lịch hẹn dành cho doanh nghiệp dịch vụ.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body className={sniglet.variable}><MantineProvider>{children}</MantineProvider></body>
    </html>
  );
}
