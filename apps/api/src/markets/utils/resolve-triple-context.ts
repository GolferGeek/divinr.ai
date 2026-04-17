export interface TripleContext {
  authorUserId: string | null;
  analystId: string;
  instrumentId: string;
}

export interface TripleEntity {
  id: string;
  user_id: string | null;
}

export function resolveTripleContext(
  analyst: TripleEntity,
  instrument: TripleEntity,
): TripleContext {
  const analystOwner = analyst.user_id ?? null;
  const instrumentOwner = instrument.user_id ?? null;

  if (analystOwner !== null && instrumentOwner !== null && analystOwner !== instrumentOwner) {
    throw new Error(
      `Mixed authorship: analyst ${analyst.id} owned by ${analystOwner}, ` +
      `instrument ${instrument.id} owned by ${instrumentOwner}`,
    );
  }

  return {
    authorUserId: analystOwner ?? instrumentOwner,
    analystId: analyst.id,
    instrumentId: instrument.id,
  };
}
