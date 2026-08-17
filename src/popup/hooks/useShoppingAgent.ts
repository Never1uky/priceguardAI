import { pollAgentSearch, submitAgentSearch, type AgentSearchState } from '@/lib/shopping-agent-client';
import {
  agentSubmitErrorMessage,
  joinAgentOffers,
  parseAgentSearchResult,
  type AgentOfferRow,
  type AgentSearchResult,
} from '@/lib/shopping-agent-result';
import { isAuthenticated } from '@/lib/supabase/auth';
import { EdgeError } from '@/lib/supabase/edge';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function useShoppingAgent() {
  const [query, setQuery] = useState('');
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [searchState, setSearchState] = useState<AgentSearchState | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    void isAuthenticated().then(setAuthed);
  }, []);

  useEffect(
    () => () => {
      stopRef.current?.();
      stopRef.current = null;
    },
    [],
  );

  const result: AgentSearchResult | null = useMemo(() => {
    if (!searchState) return null;
    if (searchState.status !== 'done' && searchState.status !== 'failed') return null;
    return parseAgentSearchResult(searchState.result);
  }, [searchState]);

  const offers: AgentOfferRow[] = useMemo(
    () => (result ? joinAgentOffers(result) : []),
    [result],
  );

  const start = useCallback(async () => {
    setSubmitError(null);
    setSearchState(null);
    setSubmitting(true);
    try {
      stopRef.current?.();
      stopRef.current = null;
      const { searchId } = await submitAgentSearch(query);
      stopRef.current = pollAgentSearch(searchId, setSearchState);
    } catch (error) {
      if (error instanceof EdgeError && error.status === 401) {
        setAuthed(false);
      }
      setSubmitError(agentSubmitErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }, [query]);

  const inProgress =
    submitting ||
    searchState?.status === 'pending' ||
    searchState?.status === 'searching' ||
    searchState?.status === 'evaluating' ||
    searchState?.status === 'ranking';

  return {
    query,
    setQuery,
    authed,
    searchState,
    result,
    offers,
    submitError,
    submitting,
    inProgress,
    start,
  };
}
