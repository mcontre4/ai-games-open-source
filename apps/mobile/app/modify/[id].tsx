import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { CreateScreen } from '../../src/presentation/CreateScreen';
export default function Modify() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CreateScreen gameId={id} />;
}
