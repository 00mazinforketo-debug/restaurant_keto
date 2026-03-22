import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import type { MenuItemDto } from "@ros/shared";

type CartLine = { menuItem: MenuItemDto; quantity: number };
type CartState = { lines: CartLine[] };
type CartAction =
  | { type: "ADD"; menuItem: MenuItemDto }
  | { type: "SET_QUANTITY"; menuItemId: string; quantity: number }
  | { type: "REMOVE"; menuItemId: string }
  | { type: "CLEAR" };

const storageKey = "ros-cart";
const reducer = (state: CartState, action: CartAction): CartState => {
  switch (action.type) {
    case "ADD": {
      const existing = state.lines.find((line) => line.menuItem.id === action.menuItem.id);
      if (existing) return { lines: state.lines.map((line) => line.menuItem.id === action.menuItem.id ? { ...line, quantity: line.quantity + 1 } : line) };
      return { lines: [...state.lines, { menuItem: action.menuItem, quantity: 1 }] };
    }
    case "SET_QUANTITY":
      return action.quantity <= 0 ? { lines: state.lines.filter((line) => line.menuItem.id !== action.menuItemId) } : { lines: state.lines.map((line) => line.menuItem.id === action.menuItemId ? { ...line, quantity: action.quantity } : line) };
    case "REMOVE":
      return { lines: state.lines.filter((line) => line.menuItem.id !== action.menuItemId) };
    case "CLEAR":
      return { lines: [] };
    default:
      return state;
  }
};

const initialState = (): CartState => {
  const stored = window.localStorage.getItem(storageKey);
  if (!stored) return { lines: [] };
  try {
    return JSON.parse(stored) as CartState;
  } catch {
    return { lines: [] };
  }
};

const CartContext = createContext<{ lines: CartLine[]; total: number; add: (menuItem: MenuItemDto) => void; setQuantity: (menuItemId: string, quantity: number) => void; remove: (menuItemId: string) => void; clear: () => void } | null>(null);

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  useEffect(() => { window.localStorage.setItem(storageKey, JSON.stringify(state)); }, [state]);
  const value = useMemo(() => ({ lines: state.lines, total: state.lines.reduce((sum, line) => sum + Number(line.menuItem.basePrice) * line.quantity, 0), add: (menuItem: MenuItemDto) => dispatch({ type: "ADD", menuItem }), setQuantity: (menuItemId: string, quantity: number) => dispatch({ type: "SET_QUANTITY", menuItemId, quantity }), remove: (menuItemId: string) => dispatch({ type: "REMOVE", menuItemId }), clear: () => dispatch({ type: "CLEAR" }) }), [state.lines]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within CartProvider");
  return context;
};
