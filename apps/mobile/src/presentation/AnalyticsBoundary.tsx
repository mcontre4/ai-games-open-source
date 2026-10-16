import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { captureMobileError } from '../adapters/analytics';
export class AnalyticsBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    captureMobileError(error, { operation: 'react_render' });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={{ flex: 1, padding: 32, justifyContent: 'center', backgroundColor: '#090d12' }}>
        <Text style={{ color: '#fff' }}>The app could not display this screen.</Text>
        <Pressable accessibilityRole="button" onPress={() => this.setState({ failed: false })}>
          <Text style={{ color: '#88efca', marginTop: 20 }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}
