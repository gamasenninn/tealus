import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../../src/App';

describe('App', () => {
  it('should render the app title', () => {
    render(<App />);
    expect(screen.getByText('Life Line')).toBeInTheDocument();
  });

  it('should render the description', () => {
    render(<App />);
    expect(screen.getByText('社内メッセンジャー')).toBeInTheDocument();
  });
});
