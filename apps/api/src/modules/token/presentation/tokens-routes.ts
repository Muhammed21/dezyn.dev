import { Hono } from "hono";
import { z } from "zod";

import type { MemberEnv } from "#platform/member-identity.ts";
import { invalidRequest, type Problem, problemResponse } from "#platform/problem.ts";
import { validate } from "#platform/validate.ts";
import { AddModeInput, PENDING_PROPOSALS_PROBLEM_TYPE, Uuid } from "@repo/contracts";

import type { ModeAdditionFailure } from "../application/add-mode.ts";
import type { AddedToken } from "../application/add-token.ts";
import type { TokenDeletionFailure } from "../application/delete-token.ts";
import type { ImportFailure } from "../application/import-tokens.ts";
import type { TokenUseCases } from "../application/token-use-cases.ts";
import { TokenDefinitionInput } from "../contracts/token-definition.ts";
import { citationMessage, issuesOfCheck, issuesOfConflicts } from "../contracts/token-issues.ts";
import { tokenIssuePath } from "../domain/dtcg-import.ts";
import type { GroupConflict } from "../domain/token-name.ts";
import { tokensOutputOf } from "./tokens-output.ts";

const tokenOutputOf = ({
  id,
  name,
  $type,
  $value,
  modes,
  $description,
  $extensions,
  status,
  replaced,
}: AddedToken) => ({
  id,
  name,
  $type,
  $value,
  modes,
  $description,
  $extensions,
  status,
  replaced,
});

const exportConflict = (conflicts: readonly GroupConflict[]): Problem => ({
  type: "about:blank",
  title: "Export impossible",
  status: 409,
  errors: issuesOfConflicts(conflicts),
});

const deletionConflict = ({ citations }: Exclude<TokenDeletionFailure, "not_found">): Problem => ({
  type: "about:blank",
  title: "Suppression impossible",
  status: 409,
  errors: [{ path: "name", message: citationMessage(citations) }],
});

const ImportedDocument = z.record(z.string(), z.unknown());

const importProblem = (failure: Exclude<ImportFailure, "not_found">): Problem =>
  "names" in failure
    ? {
        type: "about:blank",
        title: "Import impossible",
        status: 409,
        errors: failure.names.map((name) => ({
          path: `tokens.${name}`,
          message: "Token déjà présent dans le projet",
        })),
      }
    : {
        type: "about:blank",
        title: "Document invalide",
        status: 400,
        errors: [
          ...failure.issues,
          ...failure.checks.flatMap(({ name, failure: check }) =>
            issuesOfCheck(check).map(({ path, message }) => ({
              path: tokenIssuePath(name, path),
              message,
            })),
          ),
        ],
      };

const MODE_ADDITION_PROBLEMS: Readonly<Record<Exclude<ModeAdditionFailure, "not_found">, Problem>> =
  {
    pending_proposals: {
      type: PENDING_PROPOSALS_PROBLEM_TYPE,
      title: "Propositions en attente",
      status: 400,
      errors: [
        {
          path: "modes",
          message: "Propositions en attente : relisez les lots en attente avant d'ajouter un mode",
        },
      ],
    },
    no_modes: invalidRequest([
      { path: "modes", message: "Projet sans modes : aucun mode à copier" },
    ]),
    unknown_source: invalidRequest([
      { path: "copiedFrom", message: "Mode à copier absent du projet" },
    ]),
    name_taken: {
      type: "about:blank",
      title: "Mode déjà présent",
      status: 409,
      errors: [{ path: "name", message: "Mode déjà présent dans le projet" }],
    },
  };

export const tokensRoutes = ({
  addToken,
  addMode,
  deleteToken,
  readProjectTokens,
  exportTokens,
  importTokens,
}: TokenUseCases) =>
  new Hono<MemberEnv>()
    .get("/:projectId/tokens", async (c) => {
      const projectId = Uuid.safeParse(c.req.param("projectId")).data;
      if (projectId === undefined) {
        return c.notFound();
      }
      const read = await readProjectTokens({ projectId, userId: c.get("identity").userId });
      return read.ok ? c.json(tokensOutputOf(read.value)) : c.notFound();
    })
    .get("/:projectId/tokens/export", async (c) => {
      const projectId = Uuid.safeParse(c.req.param("projectId")).data;
      if (projectId === undefined) {
        return c.notFound();
      }
      const exported = await exportTokens({ projectId, userId: c.get("identity").userId });
      if (exported.ok) {
        return c.json(exported.value);
      }
      return exported.error === "not_found"
        ? c.notFound()
        : problemResponse(c, exportConflict(exported.error.conflicts));
    })
    .post("/:projectId/tokens/import", validate("json", ImportedDocument), async (c) => {
      const projectId = Uuid.safeParse(c.req.param("projectId")).data;
      if (projectId === undefined) {
        return c.notFound();
      }
      const imported = await importTokens({
        projectId,
        userId: c.get("identity").userId,
        document: c.req.valid("json"),
        correlationId: c.get("correlationId"),
      });
      if (imported.ok) {
        return c.json(imported.value, 201);
      }
      return imported.error === "not_found"
        ? c.notFound()
        : problemResponse(c, importProblem(imported.error));
    })
    .delete("/:projectId/tokens/:name", async (c) => {
      const projectId = Uuid.safeParse(c.req.param("projectId")).data;
      if (projectId === undefined) {
        return c.notFound();
      }
      const deleted = await deleteToken({
        projectId,
        userId: c.get("identity").userId,
        name: c.req.param("name"),
        correlationId: c.get("correlationId"),
      });
      if (deleted.ok) {
        return c.json(deleted.value);
      }
      return deleted.error === "not_found"
        ? c.notFound()
        : problemResponse(c, deletionConflict(deleted.error));
    })
    .post("/:projectId/modes", validate("json", AddModeInput), async (c) => {
      const projectId = Uuid.safeParse(c.req.param("projectId")).data;
      if (projectId === undefined) {
        return c.notFound();
      }
      const added = await addMode({
        projectId,
        userId: c.get("identity").userId,
        ...c.req.valid("json"),
        correlationId: c.get("correlationId"),
      });
      if (added.ok) {
        return c.json(added.value, 201);
      }
      return added.error === "not_found"
        ? c.notFound()
        : problemResponse(c, MODE_ADDITION_PROBLEMS[added.error]);
    })
    .post("/:projectId/tokens", validate("json", TokenDefinitionInput), async (c) => {
      const projectId = Uuid.safeParse(c.req.param("projectId")).data;
      if (projectId === undefined) {
        return c.notFound();
      }
      const added = await addToken({
        projectId,
        userId: c.get("identity").userId,
        token: c.req.valid("json"),
        correlationId: c.get("correlationId"),
      });
      if (added.ok) {
        return c.json(tokenOutputOf(added.value), 201);
      }
      if (added.error === "not_found") {
        return c.notFound();
      }
      return problemResponse(
        c,
        invalidRequest(
          issuesOfCheck(added.error === "name_taken" ? { code: "name_taken" } : added.error),
        ),
      );
    });
