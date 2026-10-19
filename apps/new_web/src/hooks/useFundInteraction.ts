import { useCallback } from 'react';
import { useAuth } from '../contexts/useAuth';
import api from '../services/api';

type InteractionType = 'VIEW' | 'CLICK' | 'FAVORITE' | 'START_ORDER';

export const useFundInteraction = () => {
    const { user } = useAuth();

    const trackInteraction = useCallback(async (fundId: string, type: InteractionType) => {
        if (!user?.id) return;

        try {
            await api.post(`/funds/${fundId}/interactions`, {
                investorId: user.id,
                type,
            });
        } catch (error) {
            console.error('Failed to track interaction:', error);
            // Silent fail - não queremos interromper a UX por causa de tracking
        }
    }, [user?.id]);

    return { trackInteraction };
};
