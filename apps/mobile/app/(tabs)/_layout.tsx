import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#090d12',
          borderTopColor: '#27313c',
          height: 86,
          paddingTop: 8,
          paddingBottom: 24,
        },
        tabBarActiveTintColor: '#b6ffdf',
        tabBarInactiveTintColor: '#86919e',
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
        sceneStyle: { backgroundColor: '#090d12' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'All Games',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="game-controller-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="your-games"
        options={{
          title: 'Your Games',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'You',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
