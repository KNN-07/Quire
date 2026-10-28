import type { User } from "@quire/contracts";
export type SourceLanguage = User["interfaceLanguage"];
const english = {
  source: "Source", find: "Find", outline: "Outline", check: "Code Check",
  preferences: "Preferences", shortcuts: "Shortcuts", close: "Close",
  next: "Next", previous: "Previous", replace: "Replace", replaceAll: "Replace all",
  search: "Find in current file", replacement: "Replace with", matchCase: "Match case",
  wholeWord: "Whole word", regex: "Regular expression", selection: "Selection only",
  noHeadings: "No headings in this file.", compiler: "Compiler diagnostics",
  noChecks: "No heuristic issues found.", enableCheck: "Check all files in this session",
  suppressFile: "Suppress this file", suppressRegion: "Suppress selection",
  math: "Inline math", displayMath: "Display math", refresh: "Refresh completion keys",
  interfaceLanguage: "Interface language", save: "Save preferences", saved: "Preferences saved.",
} as const;
export type SourceCopy = { readonly [K in keyof typeof english]: string };
const vietnamese: SourceCopy = {
  source: "Mã nguồn", find: "Tìm", outline: "Đề mục", check: "Kiểm tra mã",
  preferences: "Tùy chọn", shortcuts: "Phím tắt", close: "Đóng",
  next: "Tiếp", previous: "Trước", replace: "Thay thế", replaceAll: "Thay tất cả",
  search: "Tìm trong tệp hiện tại", replacement: "Thay bằng", matchCase: "Phân biệt hoa thường",
  wholeWord: "Nguyên từ", regex: "Biểu thức chính quy", selection: "Chỉ vùng chọn",
  noHeadings: "Tệp này chưa có đề mục.", compiler: "Chẩn đoán trình biên dịch",
  noChecks: "Không phát hiện vấn đề theo quy tắc.", enableCheck: "Kiểm tra mọi tệp trong phiên này",
  suppressFile: "Bỏ qua tệp này", suppressRegion: "Bỏ qua vùng chọn",
  math: "Toán nội dòng", displayMath: "Toán riêng dòng", refresh: "Tải lại khóa gợi ý",
  interfaceLanguage: "Ngôn ngữ giao diện", save: "Lưu tùy chọn", saved: "Đã lưu tùy chọn.",
};
const chinese: SourceCopy = {
  source: "源代码", find: "查找", outline: "大纲", check: "代码检查",
  preferences: "偏好设置", shortcuts: "快捷键", close: "关闭",
  next: "下一项", previous: "上一项", replace: "替换", replaceAll: "全部替换",
  search: "在当前文件中查找", replacement: "替换为", matchCase: "区分大小写",
  wholeWord: "全字匹配", regex: "正则表达式", selection: "仅选中区域",
  noHeadings: "此文件没有标题。", compiler: "编译器诊断",
  noChecks: "未发现启发式检查问题。", enableCheck: "检查此会话中的所有文件",
  suppressFile: "忽略此文件", suppressRegion: "忽略选中区域",
  math: "行内公式", displayMath: "独立公式", refresh: "刷新补全键",
  interfaceLanguage: "界面语言", save: "保存偏好设置", saved: "偏好设置已保存。",
};
export const sourceCatalog: Readonly<Record<SourceLanguage, SourceCopy>> = { en: english, vi: vietnamese, zh: chinese };
