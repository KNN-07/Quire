export function Landing() {
  return <>
    <section className="qm-wrap qm-hero">
      <span className="qm-pill">LaTeX editor for research teams</span>
      <h1>Write LaTeX together.<br />Version it like code.</h1>
      <p>Edit source or a visual document, watch the PDF build beside it, and keep every change in real git - with your organization's single sign-on.</p>
      <div className="qm-actions"><a className="qm-link-button qm-primary" href="/sign-up">Start writing - free</a><a className="qm-link-button" href="/projects?view=templates">Browse templates</a></div>
      <small>Runs in the browser · Compiles with your installed TeX Live environment</small>
      <EditorIllustration />
    </section>
    <section id="views" className="qm-band"><div className="qm-wrap qm-section">
      <h2>One document, four ways to see it</h2>
      <p className="qm-lead">Co-authors who live in source and co-authors who never want to see a backslash can work in the same file.</p>
      <div className="qm-grid qm-four">{[
        ["Source", "A code editor with LaTeX autocomplete, linting and Vim or Emacs keys."],
        ["Split", "Source and PDF side by side. SyncTeX connects the source to compiled output."],
        ["Visual", "Edit the document directly, with source preserved for unsupported commands."],
        ["PDF", "Read the compiled paper, with zoom, page navigation and presentation views."],
      ].map(([name, text]) => <article className="qm-card" key={name}><div className={`qm-view-sample qm-view-${name}`} aria-hidden="true"><span /><span /></div><h3>{name}</h3><p>{text}</p></article>)}</div>
    </div></section>
    <section id="git" className="qm-wrap qm-section qm-split">
      <div><span className="qm-eyebrow">Real git, not an export</span><h2>Your paper is a repository</h2><p className="qm-lead">Clone it, branch it, commit it. Work offline with the tools you already use, then bring your changes back to Quire.</p><ul><li>Review source changes before you commit</li><li>Keep branches for experiments and submissions</li><li>Connect remote providers when configured</li></ul><a href="/projects">Open your projects</a></div>
      <figure className="qm-code qm-terminal"><figcaption>Illustrative Git workflow</figcaption><pre>{`git clone <your-project-clone-url>\ngit switch -c revision\n# edit your paper locally\ngit add main.tex\ngit commit -m "Revise introduction"\ngit push origin revision`}</pre></figure>
    </section>
    <section id="ai" className="qm-band qm-ai-band"><div className="qm-wrap qm-section qm-split">
      <figure className="qm-card qm-ai-sample"><figcaption>Illustrative proposed edit</figcaption><p>Tighten the abstract and check the citation.</p><pre>- of their environment and plan inside it.<br />+ their environment and plan inside it.</pre><p>Review the proposed diff before applying it.</p></figure>
      <div><span className="qm-eyebrow">AI assistant</span><h2>A co-author that knows LaTeX - and shows its work</h2><p className="qm-lead">Ask about your paper, or give the agent a task. AI requires your operator's configured model and endpoint.</p><ul><li>Ask questions using selected project context</li><li>Review proposed changes before applying them</li><li>Keep provider and citation search settings explicit</li></ul><a href="/self-hosting#ai">Bring your own model - or none</a></div>
    </div></section>
    <section className="qm-wrap qm-section"><h2>Everything else a paper needs</h2><div className="qm-grid qm-three qm-feature-list">{[
      ["Real-time co-editing", "Work with co-authors in source and visual views."],
      ["Comments and track changes", "Suggest edits, resolve threads, and review changes."],
      ["Templates", "Articles, conference papers, theses, Beamer decks and your lab's own."],
      ["Isolated compile", "pdfLaTeX, LaTeX, XeLaTeX and LuaLaTeX in installed sandbox profiles."],
      ["Reference manager", "Keep bibliography entries alongside your projects."],
      ["Full history", "Review and restore earlier versions of your work."],
    ].map(([name, text]) => <article key={name}><h3>{name}</h3><p>{text}</p></article>)}</div></section>
    <section id="teams" className="qm-dark"><div className="qm-wrap qm-section qm-split"><div><span className="qm-eyebrow">For organizations</span><h2>Built for labs, departments and publishers</h2><p className="qm-lead">One workspace, managed by your IT team, with identity and policy configured for your institution.</p><a className="qm-link-button" href="/institutions">Find your institution</a></div><div className="qm-grid qm-two">{[
      ["Single sign-on", "SAML, OIDC and LDAP require a configured identity provider."],
      ["Managed membership", "Institutional enrollment follows verified identity and organization policy."],
      ["Shared templates", "Publish house styles that everyone starts from."],
      ["Custom TeX Live", "Pin installed environments, packages and fonts."],
      ["Audit log", "Review administrative events and access changes."],
      ["Your storage", "Local SQLite and disk by default; scale deployment is a separate profile."],
    ].map(([name, text]) => <article key={name}><h3>{name}</h3><p>{text}</p></article>)}</div></div></section>
    <section className="qm-wrap qm-section qm-center"><h2>Pricing</h2><p className="qm-lead">The local edition is unbilled. Hosted prices and support terms come from your operator.</p><div className="qm-actions"><a className="qm-link-button" href="/pricing">Compare options</a><a href="/self-hosting">Host Quire yourself</a></div></section>
    <section className="qm-band"><div className="qm-faq qm-section"><h2>A few questions</h2><details open><summary>Do I need to install LaTeX?</summary><p>Not on your writing device. The server needs an installed and verified TeX Live environment and an isolated compile worker.</p></details><details><summary>Can I work offline?</summary><p>Clone your project with Git to edit locally. Browser collaboration needs a connection to your server.</p></details><details><summary>Can we host it ourselves?</summary><p>Yes. Start with the native local profile and read the deployment requirements before exposing it to a network.</p><a href="/self-hosting">Self-hosting guide</a></details></div></section>
    <section className="qm-wrap qm-section qm-center qm-closing"><h2>Your next paper starts here.</h2>
      <div className="qm-actions"><a className="qm-link-button qm-primary" href="/sign-up">Create your account</a></div></section>
  </>;
}

function EditorIllustration() {
  return <figure className="qm-editor" aria-label="Illustrative source and PDF preview, not a live editor">
    <figcaption><span>Quire</span><span>Illustrative editor preview</span><span>Source + PDF</span></figcaption>
    <div className="qm-editor-body"><aside>main.tex<br />references.bib<br />figures/</aside><pre>{`\\section{Introduction}\nModel-based methods predict the next\nlatent state $z_{t+1}$ from $z_t$:\n\\begin{equation}\n  z_{t+1} = f_\\theta(z_t, a_t)\n\\end{equation}\nas shown in Figure~\\ref{fig:arch}.\n\n\\subsection{Planning}\n% Mai: add MPC baseline here`}</pre><div className="qm-paper-back"><div className="qm-paper"><h3>1 Introduction</h3><p>Model-based methods predict the next latent state <i>z<sub>t+1</sub></i> from <i>z<sub>t</sub></i>:</p><p className="qm-equation">z<sub>t+1</sub> = f<sub>θ</sub>(z<sub>t</sub>, a<sub>t</sub>)</p><p>as shown in Figure 1.</p><div className="qm-figure" /><p>Figure 1: Architecture.</p></div></div></div>
  </figure>;
}
