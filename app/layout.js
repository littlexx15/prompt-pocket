export const metadata = {
  title: "Prompt Pocket",
  description: "个人提示词、案例与参考资产管理工具"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
