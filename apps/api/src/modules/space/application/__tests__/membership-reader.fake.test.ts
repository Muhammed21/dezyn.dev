import { inMemoryMembershipReader } from "../membership-reader.fake.ts";
import { describeMembershipReaderContract } from "./membership-reader.contract.ts";

describeMembershipReaderContract(async (memberships) => inMemoryMembershipReader(memberships));
