import { render } from '@testing-library/react';
import App from './App';

test('renders App root element', () => {
  render(<App />);
  const rootElement = document.querySelector('.App');
  expect(rootElement).toBeInTheDocument();
});
