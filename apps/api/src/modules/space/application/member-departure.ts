export type MemberDeparture = {
  readonly spaceId: string;
  readonly userId: string;
  readonly at: Date;
};

export type DepartureListener = (departure: MemberDeparture) => Promise<void>;
