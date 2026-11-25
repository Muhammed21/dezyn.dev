export type RecipeFigmaFile = { readonly url: string; readonly key: string };

export type RecipeProject = {
  readonly id: string;
  readonly name: string;
  readonly figmaFile: RecipeFigmaFile | null;
};

export type Recipe = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly instructionsFor: (context: {
    readonly project: RecipeProject;
    readonly today: Date;
  }) => string;
};
