import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { SharedTabMonthProvider } from '../../contexts/SharedTabMonthContext';
import { useTheme } from '../../contexts/ThemeContext';

export default function TabLayout() {
  const { colors, isDarkMode } = useTheme();

  return (
    <SharedTabMonthProvider>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          },
          headerShown: false,
        }}>
        <Tabs.Screen
          name="agenda"
          options={{
            title: 'Agenda',
            tabBarIcon: ({ color }) => <Ionicons name="calendar" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="feed"
          options={{
            title: 'Feed',
            tabBarIcon: ({ color }) => <Ionicons name="newspaper" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="financeiro"
          options={{
            title: 'Financeiro',
            tabBarIcon: ({ color }) => <Ionicons name="card" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="configuracoes"
          options={{
            title: 'Configurações',
            tabBarIcon: ({ color }) => <Ionicons name="settings" size={24} color={color} />,
          }}
        />
      </Tabs>
    </SharedTabMonthProvider>
  );
}
