import type { ReactNode } from "react";

import type { TokenValue } from "../domain/proposal.ts";
import type { AliasSources } from "./alias-sources.ts";
import { aliasPreviewOf, type AliasValues } from "./alias.ts";
import type { Preview, SamplePreview } from "./preview.ts";

const CHECKERBOARD = {
  backgroundImage: "repeating-conic-gradient(#c8c8c8 0% 25%, #ffffff 0% 50%)",
  backgroundSize: "0.75rem 0.75rem",
};

const Swatch = ({ style }: { readonly style: { readonly backgroundColor: string } }) => (
  <span
    aria-hidden="true"
    style={{
      ...CHECKERBOARD,
      display: "block",
      width: "2.5rem",
      height: "2.5rem",
      borderRadius: "0.375rem",
      border: "1px solid #c8c8c8",
      overflow: "hidden",
    }}
  >
    <span style={{ ...style, display: "block", width: "100%", height: "100%" }} />
  </span>
);

const ShadowCard = ({ style }: { readonly style: { readonly boxShadow: string } }) => (
  <span
    aria-hidden="true"
    style={{
      ...style,
      display: "block",
      width: "4rem",
      height: "2.5rem",
      margin: "0.75rem",
      borderRadius: "0.375rem",
      backgroundColor: "#ffffff",
    }}
  />
);

const Bar = ({ style }: { readonly style: { readonly width: string } }) => (
  <span
    aria-hidden="true"
    style={{
      ...style,
      display: "block",
      maxWidth: "100%",
      height: "0.75rem",
      borderRadius: "0.125rem",
      backgroundColor: "currentColor",
    }}
  />
);

const Band = ({ style }: { readonly style: { readonly backgroundImage: string } }) => (
  <span
    aria-hidden="true"
    style={{
      ...CHECKERBOARD,
      display: "block",
      height: "1.5rem",
      borderRadius: "0.375rem",
      border: "1px solid #c8c8c8",
      overflow: "hidden",
    }}
  >
    <span style={{ ...style, display: "block", width: "100%", height: "100%" }} />
  </span>
);

const Sample = ({ style }: { readonly style: SamplePreview["style"] }) => (
  <span aria-hidden="true" style={{ ...style, display: "block", overflowWrap: "anywhere" }}>
    Portez ce vieux whisky au juge blond qui fume
  </span>
);

const Drawing = ({ preview }: { readonly preview: Preview }) => {
  switch (preview.shape) {
    case "swatch":
      return <Swatch style={preview.style} />;
    case "bar":
      return <Bar style={preview.style} />;
    case "shadow":
      return <ShadowCard style={preview.style} />;
    case "band":
      return <Band style={preview.style} />;
    case "sample":
      return <Sample style={preview.style} />;
    default:
      return null;
  }
};

const PreviewFigure = ({
  label,
  column,
  token,
  aliases,
  children,
}: {
  readonly label: string;
  readonly column: number;
  readonly token: TokenValue;
  readonly aliases: AliasValues;
  readonly children?: ReactNode;
}) => {
  const { preview, references } = aliasPreviewOf({
    type: token.$type,
    value: token.$value,
    values: aliases,
  });
  const designated = references.join(", ");
  return (
    <figure
      aria-label={
        references.length === 0
          ? `${label} : ${preview.text}`
          : `${label} : ${preview.text}, alias de ${designated}`
      }
      style={{
        margin: 0,
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
        gridColumn: column,
      }}
    >
      <figcaption>{label}</figcaption>
      {children}
      {references.length === 0 ? null : <p style={{ margin: 0 }}>Alias de {designated}</p>}
      <Drawing preview={preview} />
      <code style={{ overflowWrap: "anywhere" }}>{preview.text}</code>
    </figure>
  );
};

export const BeforeAfter = ({
  validated,
  proposed,
  aliases,
}: {
  readonly validated: TokenValue | undefined;
  readonly proposed: TokenValue;
  readonly aliases: AliasSources;
}) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
    {validated === undefined ? null : (
      <PreviewFigure label="Avant" column={1} token={validated} aliases={aliases.before} />
    )}
    <PreviewFigure label="Après" column={2} token={proposed} aliases={aliases.after}>
      {validated === undefined ? <p style={{ margin: 0 }}>Nouveau token</p> : null}
    </PreviewFigure>
  </div>
);
