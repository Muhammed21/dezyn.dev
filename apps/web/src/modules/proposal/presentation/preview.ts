export type SwatchPreview = {
  readonly shape: "swatch";
  readonly text: string;
  readonly style: { readonly backgroundColor: string };
};

export type TextPreview = { readonly shape: "text"; readonly text: string };

export type Preview = SwatchPreview | TextPreview;
