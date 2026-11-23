import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createHistory } from "./modules/history/history-module.ts";
import { projectHistoryRoute } from "./modules/history/presentation/project-history-route.tsx";
import { createIdentity } from "./modules/identity/identity-module.ts";
import { accountRoute } from "./modules/identity/presentation/account-route.tsx";
import { signInRoute } from "./modules/identity/presentation/sign-in-route.tsx";
import { signUpRoute } from "./modules/identity/presentation/sign-up-route.tsx";
import { projectBanners } from "./modules/project/presentation/project-banners.tsx";
import { spaceProjectsRoute } from "./modules/project/presentation/space-projects-route.tsx";
import { createProjectEvents, createProjects } from "./modules/project/project-module.ts";
import { projectProposals } from "./modules/proposal/presentation/project-proposals.tsx";
import { proposalBatchRoute } from "./modules/proposal/presentation/proposal-batch-route.tsx";
import { createProposals } from "./modules/proposal/proposal-module.ts";
import { invitationRoute } from "./modules/space/presentation/invitation-route.tsx";
import { inviteMemberForm } from "./modules/space/presentation/invite-member.tsx";
import { leaveSpaceAction } from "./modules/space/presentation/leave-space.tsx";
import { mySpacesRoute } from "./modules/space/presentation/my-spaces-route.tsx";
import { spaceFrozenAlert } from "./modules/space/presentation/space-frozen-alert.tsx";
import { spaceMembers } from "./modules/space/presentation/space-members.tsx";
import { spacePaymentAlert } from "./modules/space/presentation/space-payment-alert.tsx";
import { spacePlanRoute } from "./modules/space/presentation/space-plan-route.tsx";
import { spaceStorageAlert } from "./modules/space/presentation/space-storage-alert.tsx";
import { createSpaces } from "./modules/space/space-module.ts";
import {
  projectTokensRoute,
  refreshProjectTokens,
} from "./modules/token/presentation/project-tokens-route.tsx";
import { createTokens } from "./modules/token/token-module.ts";
import { configOf } from "./platform/config.ts";

const fetchFromBrowser = (url: string, init: RequestInit) => window.fetch(url, init);

const openBrowserSocket = (url: string) => new WebSocket(url);

const scheduleInBrowser = (delayMs: number, run: () => void) => {
  const timer = window.setTimeout(run, delayMs);
  return () => window.clearTimeout(timer);
};

const clock = () => new Date();

const goToInBrowser = (url: string) => window.location.assign(url);

const CHECKOUT_RETURN_POLLING = { intervalMs: 2_000, timeoutMs: 30_000 };

const appRouter = ({
  apiUrl,
  queryClient,
}: {
  readonly apiUrl: string;
  readonly queryClient: QueryClient;
}) => {
  const identity = createIdentity({ apiUrl, fetch: fetchFromBrowser });
  const spaces = createSpaces({ apiUrl, fetch: fetchFromBrowser });
  const projects = createProjects({ apiUrl, fetch: fetchFromBrowser });
  const tokens = createTokens({ apiUrl, fetch: fetchFromBrowser });
  const projectHistory = createHistory({ apiUrl, fetch: fetchFromBrowser });
  const proposals = createProposals({ apiUrl, fetch: fetchFromBrowser });
  const projectEvents = createProjectEvents({
    apiUrl,
    openSocket: openBrowserSocket,
    schedule: scheduleInBrowser,
  });

  const SpaceStorageAlert = spaceStorageAlert({ readSpace: spaces.readSpace });
  const SpacePaymentAlert = spacePaymentAlert({ readSpace: spaces.readSpace });
  const SpaceFrozenAlert = spaceFrozenAlert({ readSpace: spaces.readSpace });

  const root = createRootRoute();
  return createRouter({
    routeTree: root.addChildren([
      mySpacesRoute({
        parent: root,
        listMySpaces: spaces.listMySpaces,
        signOut: identity.signOut,
      }),
      signInRoute({ parent: root, signIn: identity.signIn }),
      invitationRoute({ parent: root, acceptInvitation: spaces.acceptInvitation }),
      signUpRoute({ parent: root, signUp: identity.signUp }),
      accountRoute({
        parent: root,
        accountDeletion: identity.accountDeletion,
        deleteAccount: identity.deleteAccount,
      }),
      spaceProjectsRoute({
        parent: root,
        listProjects: projects.listProjects,
        createProject: projects.createProject,
        readSpace: spaces.readSpace,
        InviteMember: inviteMemberForm({ inviteMember: spaces.inviteMember }),
        SpaceMembers: spaceMembers({
          listMembers: spaces.listMembers,
          readSpace: spaces.readSpace,
          changeRole: spaces.changeRole,
          removeMember: spaces.removeMember,
          LeaveSpace: leaveSpaceAction({
            readSpace: spaces.readSpace,
            leaveSpace: spaces.leaveSpace,
          }),
        }),
        SpaceStorageAlert,
        SpacePaymentAlert,
        SpaceFrozenAlert,
        clock,
      }),
      spacePlanRoute({
        parent: root,
        readSpace: spaces.readSpace,
        startCheckout: spaces.startCheckout,
        openPortal: spaces.openPortal,
        goTo: goToInBrowser,
        polling: CHECKOUT_RETURN_POLLING,
      }),
      projectTokensRoute({
        parent: root,
        readTokens: tokens.readTokens,
        ProjectProposals: projectProposals({
          listBatches: proposals.listBatches,
          subscribe: projectEvents.subscribe,
        }),
        ProjectBanners: projectBanners({
          readProject: projects.readProject,
          SpaceStorageAlert,
          clock,
        }),
        subscribe: projectEvents.subscribe,
      }),
      projectHistoryRoute({
        parent: root,
        readHistory: projectHistory.readHistory,
        subscribe: projectEvents.subscribe,
      }),
      proposalBatchRoute({
        parent: root,
        readBatch: proposals.readBatch,
        readTokens: tokens.readTokens,
        reviewProposal: proposals.reviewProposal,
        validateBatch: proposals.validateBatch,
        onReviewed: refreshProjectTokens(queryClient),
        subscribe: projectEvents.subscribe,
      }),
    ]),
  });
};

const config = configOf({
  env: import.meta.env,
  href: window.location.href,
  dev: import.meta.env.DEV,
});
const container = document.getElementById("root");
const queryClient = new QueryClient();

if (config.kind === "redirect") {
  window.location.replace(config.to);
} else if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      {config.kind === "ready" ? (
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={appRouter({ apiUrl: config.apiUrl, queryClient })} />
        </QueryClientProvider>
      ) : (
        <p role="alert">{config.message}</p>
      )}
    </StrictMode>,
  );
}
