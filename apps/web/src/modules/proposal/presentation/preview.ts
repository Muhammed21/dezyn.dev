export type SwatchPreview = {
  readonly shape: "swatch";
  readonly text: string;
  readonly style: { readonly backgroundColor: string };
};

export type ShadowPreview = {
  readonly shape: "shadow";
  readonly text: string;
  readonly style: { readonly boxShadow: string };
};

export type BandPreview = {
  readonly shape: "band";
  readonly text: string;
  readonly style: { readonly backgroundImage: string };
};

export type SamplePreview = {
  readonly shape: "sample";
  readonly text: string;
  readonly style: {
    readonly fontFamily?: string;
    readonly fontSize?: string;
    readonly fontWeight?: number;
    readonly lineHeight?: number;
    readonly letterSpacing?: string;
  };
};

export type BarPreview = {
  readonly shape: "bar";
  readonly text: string;
  readonly style: { readonly width: string };
};

export type TextPreview = { readonly shape: "text"; readonly text: string };

export type Preview =
  | SwatchPreview
  | BarPreview
  | ShadowPreview
  | BandPreview
  | SamplePreview
  | TextPreview;
