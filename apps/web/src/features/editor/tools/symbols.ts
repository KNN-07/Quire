export type SymbolEntry = {
  readonly glyph: string; readonly command: string; readonly category: string; readonly packageName?: string;
};

const groups = {
  Greek: [["α", "\\alpha"], ["β", "\\beta"], ["γ", "\\gamma"], ["δ", "\\delta"], ["ε", "\\epsilon"], ["θ", "\\theta"], ["λ", "\\lambda"], ["μ", "\\mu"], ["π", "\\pi"], ["σ", "\\sigma"], ["φ", "\\phi"], ["ω", "\\omega"], ["Γ", "\\Gamma"], ["Δ", "\\Delta"], ["Θ", "\\Theta"], ["Λ", "\\Lambda"], ["Σ", "\\Sigma"], ["Ω", "\\Omega"]],
  Operators: [["∑", "\\sum"], ["∏", "\\prod"], ["∫", "\\int"], ["∮", "\\oint"], ["∂", "\\partial"], ["∇", "\\nabla"], ["×", "\\times"], ["÷", "\\div"], ["±", "\\pm"], ["∓", "\\mp"], ["·", "\\cdot"], ["∘", "\\circ"], ["⊗", "\\otimes"], ["⊕", "\\oplus"], ["∪", "\\cup"], ["∩", "\\cap"], ["√", "\\sqrt{}"], ["∞", "\\infty"]],
  Relations: [["≤", "\\leq"], ["≥", "\\geq"], ["≠", "\\neq"], ["≈", "\\approx"], ["≡", "\\equiv"], ["∼", "\\sim"], ["∝", "\\propto"], ["∈", "\\in"], ["∉", "\\notin"], ["⊂", "\\subset"], ["⊆", "\\subseteq"], ["⊃", "\\supset"], ["≪", "\\ll"], ["≫", "\\gg"], ["⊥", "\\perp"], ["∥", "\\parallel"], ["≅", "\\cong"], ["≜", "\\triangleq"]],
  Arrows: [["→", "\\to"], ["←", "\\leftarrow"], ["↔", "\\leftrightarrow"], ["⇒", "\\Rightarrow"], ["⇐", "\\Leftarrow"], ["⇔", "\\Leftrightarrow"], ["↦", "\\mapsto"], ["↑", "\\uparrow"], ["↓", "\\downarrow"], ["⟶", "\\longrightarrow"], ["⟹", "\\Longrightarrow"], ["↪", "\\hookrightarrow"]],
  Misc: [["ℝ", "\\mathbb{R}"], ["ℕ", "\\mathbb{N}"], ["ℤ", "\\mathbb{Z}"], ["∀", "\\forall"], ["∃", "\\exists"], ["∅", "\\emptyset"], ["ℓ", "\\ell"], ["ℏ", "\\hbar"], ["†", "\\dagger"], ["…", "\\ldots"], ["⋯", "\\cdots"], ["°", "^\\circ"]],
} as const;
export const symbolCategories = Object.keys(groups);
export const symbols: readonly SymbolEntry[] = Object.entries(groups).flatMap(([category, entries]) =>
  entries.map(([glyph, command]) => ({ glyph, command, category,
    ...(command.startsWith("\\mathbb") || command === "\\triangleq" ? { packageName: "amssymb" } : {}) })));
