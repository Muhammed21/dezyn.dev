import type { ReactNode } from "react";

import type { TokenValue } from "../domain/proposal.ts";
import type { Preview, SamplePreview } from "./preview.ts";
import { previewOf } from "./token-preview.ts";

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
  children,
}: {
  readonly label: string;
  readonly column: number;
  readonly token: TokenValue;
  readonly children?: ReactNode;
}) => {
  const preview = previewOf({ type: token.$type, value: token.$value });
  return (
    <figure
      aria-label={`${label} : ${preview.text}`}
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
      <Drawing preview={preview} />
      <code style={{ overflowWrap: "anywhere" }}>{preview.text}</code>
    </figure>
  );
};

export const BeforeAfter = ({
  validated,
  proposed,
}: {
  readonly validated: TokenValue | undefined;
  readonly proposed: TokenValue;
}) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
    {validated === undefined ? null : <PreviewFigure label="Avant" column={1} token={validated} />}
    <PreviewFigure label="Après" column={2} token={proposed}>
      {validated === undefined ? <p style={{ margin: 0 }}>Nouveau token</p> : null}
    </PreviewFigure>
  </div>
);
