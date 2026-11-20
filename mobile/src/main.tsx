import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { UIProvider } from '@/lib/ui-config';
import App from './App';
import './index.css';
import './wallet.css';

createRoot(document.getElementById('root')!).render(
  <UIProvider locale="zh-CN" reducedMotion="user" defaults={{ button: { radius: 'lg' }, drawer: { closeLabel: '关闭' } }}>
    <MotionConfig reducedMotion="user"><App /></MotionConfig>
  </UIProvider>,
);
