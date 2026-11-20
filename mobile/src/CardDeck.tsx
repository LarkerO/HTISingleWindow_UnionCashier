import { useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react';
import { CreditCard, Layers3, Wallet as WalletIcon, Wifi } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { AnimatedCounter } from '@/components/ui/animated-counter';
import { springs, usePrefersReducedMotion } from '@/lib/motion';
import { gestureIntent } from './payment';
import type { PaymentCard } from './types';

const icons = { vault: WalletIcon, scoreboard: Layers3, prepaid: CreditCard };

type Props = {
  cards: PaymentCard[]; selected: string; onSelect: (key: string) => void;
  holder: string; environment: string; paying?: boolean; locked?: boolean;
  onPay?: () => void; rejection?: string; onReject?: (reason: string) => void;
};

export default function CardDeck({ cards, selected, onSelect, holder, environment, paying = false, locked = false, onPay, rejection, onReject }: Props) {
  const reduced = usePrefersReducedMotion();
  const card = cards.find(value => value.key === selected) ?? cards[0];
  const index = cards.indexOf(card);
  const [direction, setDirection] = useState(1);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const blocked = useRef(false);
  const axis = useRef<'x' | 'y' | null>(null);
  if (!card) return null;
  const Icon = icons[card.type];

  function select(key: string) {
    if (locked || key === card.key) return;
    setDirection(cards.findIndex(value => value.key === key) > index ? 1 : -1);
    x.set(0); y.set(0);
    onSelect(key);
  }

  return <section className={'card-deck ' + (paying ? 'payment-deck' : '')} aria-label={paying ? '选择付款卡片' : '我的钱包'}>
    <div className="deck-stage" data-vaul-no-drag>
      <div className="card-peek card-peek-back" aria-hidden="true" />
      <div className="card-peek" aria-hidden="true" />
      <AnimatePresence initial={false} mode="popLayout" custom={direction}>
        <motion.div key={card.key} className="draggable-card" custom={direction}
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: direction * 80, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, x: direction * -80, scale: 0.97 }}
          transition={springs.smooth}>
          <motion.div style={{ x, y, touchAction: paying ? 'none' : 'pan-y' }}
            onPanStart={() => { blocked.current = false; axis.current = null; }}
            onPan={(_, info) => {
              if (locked || blocked.current) return;
              const { x: dx, y: dy } = info.offset;
              if (!axis.current && Math.max(Math.abs(dx), Math.abs(dy)) > 10) axis.current = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
              if (axis.current === 'x') x.set(dx * ((index === 0 && dx > 0) || (index === cards.length - 1 && dx < 0) ? 0.2 : 0.8));
              if (paying && axis.current === 'y') {
                y.set(Math.min(22, Math.max(-160, dy)));
                if (rejection && dy < -28) {
                  blocked.current = true;
                  void animate(y, 0, springs.bouncy);
                  onReject?.(rejection);
                }
              }
            }}
            onPanEnd={(_, info) => {
              if (!locked && !blocked.current) {
                const intent = gestureIntent(info.offset.x, info.offset.y, paying);
                if (axis.current === 'x' && intent === 'next' && index < cards.length - 1) select(cards[index + 1].key);
                if (axis.current === 'x' && intent === 'previous' && index > 0) select(cards[index - 1].key);
                if (axis.current === 'y' && intent === 'pay') rejection ? onReject?.(rejection) : onPay?.();
              }
              void animate(x, 0, springs.smooth);
              void animate(y, 0, springs.bouncy);
            }}>
            <Card variant="elevated" radius="lg" className={'wallet-card wallet-card-' + card.type}
              data-testid="wallet-card" aria-label={card.name + '，余额 ' + (card.balance ?? '暂不可用')}
              style={card.art ? { backgroundImage: `linear-gradient(135deg, #0c182cbb, #0c182c66), url(/api/card-art/${card.art})` } : undefined}>
              <div className="wallet-card-top"><span className="wallet-card-label"><Icon size={18} />{card.name}</span><Wifi size={21} className="contactless" aria-hidden="true" /></div>
              <div className="wallet-card-middle"><span className="balance-caption">可用余额 {environment === 'sandbox' && <Badge size="sm" variant="outline">沙箱</Badge>}</span>
                <div className="card-amount">{card.balance == null ? '—' : <AnimatedCounter value={card.balance} duration={0.45} fade={false} />}<span>游戏单位</span></div>
              </div>
              <div className="wallet-card-bottom"><div><span className="card-holder">{holder}</span><span className="card-detail">{card.detail}</span></div><span className="card-mark" aria-hidden="true">HT<span>·</span>ISW</span></div>
            </Card>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </div>
    <div inert={locked} className="deck-tab-shell">
      <Tabs className="deck-tabs" value={card.key} onValueChange={select} variant="pill" size="sm"
        aria-label="切换钱包卡片" options={cards.map(value => ({ value: value.key, label: value.type === 'prepaid' ? value.name : value.type === 'vault' ? 'Vault' : '计分板' }))} />
    </div>
    <p className="deck-counter" aria-hidden="true">{index + 1} / {cards.length}<span>左右滑动切换卡片</span></p>
  </section>;
}
