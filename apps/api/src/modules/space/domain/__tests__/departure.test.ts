import { describe, expect, it } from "vitest";

import { blocksAccountDeletion, departureRefusal } from "../departure.ts";

describe("un espace garde toujours un propriétaire (ADR 0011 §5)", () => {
  it("un propriétaire part s'il reste un autre propriétaire", () => {
    expect(departureRefusal({ role: "owner", openOwners: 2 })).toBeUndefined();
  });

  it("le seul propriétaire ne part pas", () => {
    expect(departureRefusal({ role: "owner", openOwners: 1 })).toBe("last_owner");
  });

  it("un éditeur part, même avec un seul propriétaire", () => {
    expect(departureRefusal({ role: "editor", openOwners: 1 })).toBeUndefined();
  });
});

describe("le dernier propriétaire nomme un successeur avant de supprimer son compte (ADR 0011 §5)", () => {
  it("le seul propriétaire d'un espace qui a d'autres membres ne supprime pas son compte", () => {
    expect(blocksAccountDeletion({ role: "owner", openOwners: 1, openMembers: 2 })).toBe(true);
  });

  it("le seul membre d'un espace n'a personne à nommer : l'espace ne bloque pas", () => {
    expect(blocksAccountDeletion({ role: "owner", openOwners: 1, openMembers: 1 })).toBe(false);
  });

  it("un propriétaire parmi d'autres supprime son compte", () => {
    expect(blocksAccountDeletion({ role: "owner", openOwners: 2, openMembers: 3 })).toBe(false);
  });

  it("un éditeur supprime son compte, même avec un seul propriétaire", () => {
    expect(blocksAccountDeletion({ role: "editor", openOwners: 1, openMembers: 2 })).toBe(false);
  });
});
