# Remi — Game Rules

Serbian version: [PRAVILA.md](PRAVILA.md). Both files describe the same rules, section by section.
These are the rules the game code enforces.

## 1. Cards and players

- Played with **2 decks = 108 cards** (2 × 52 + 4 jokers).
- Every player gets **14 cards**. The player who acts first gets a **15th** card.

## 2. Dealing and cutting

- The **dealer rotates** every round to the next player around the table.
- The player to the dealer's **right cuts**; the player to the dealer's **left** acts first.
- The cut card is turned face-up and placed at the bottom of the talon (stock).
- **Bonus joker:**
  - If the cut card is a joker, the **cutter** gets it.
  - If the card directly under it is a joker, the **dealer** gets it.
  - A player who gets a bonus joker still ends up with 14 cards in total (13 + the joker).
- There is always a visible card **under the talon**. If the cut card went to the cutter as a bonus joker, the next card is turned up to take its place. If that card is a joker too, it goes to the dealer as a bonus and the next card is tried, until a non-joker fills the slot.

## 3. A turn

1. **Draw** one card: from the top of the talon, or the top card of the discard pile.
2. **Play** (optional): lay down melds, add cards to melds on the table, swap jokers.
3. **Discard** one card onto the discard pile.

- You must always keep at least one card to discard; you can't lay down your whole hand.
- If the talon runs out, the discard pile (except its top card) is shuffled into a new talon.

### Drawing from the discard pile

- Allowed only if you **lay that card down in the same turn** (in a new meld or added to one on the table). Just keeping it in your hand isn't allowed.
- Until it's laid down you can't discard any other card. You can put it back on the discard pile, which takes your turn back to the draw.
- With only one card in hand you can't draw from the discard pile.

### The card under the talon

- Instead of the normal draw, you may take the card under the talon, **but only if it lets you go out with a hand** (mali, veliki or four jokers, see section 6) in that same turn.
- A player who has already opened can't take it (hands are closed to them).
- Once taken, you either go out with the hand or put the card back under the talon, which takes your turn back to the draw.
- It can end up on the discard pile only as the odd card thrown when declaring a hand made of the other 14 cards.
- While you hold it you can't lay melds, add to melds or swap jokers.

### Discarding a joker

- A joker can be discarded only if it's your **last card**.

## 4. Melds

- **Run:** 3 or more cards of the same suit in sequence. The ace can be low (A-2-3) or high (Q-K-A), but a run can't wrap around (K-A-2 isn't allowed).
- **Set:** 3 or 4 cards of the same rank, all different suits.
- A **joker** can stand in for any card in a meld. A meld must contain at least one real card.

## 5. Opening (laying down for the first time)

- The first time you lay melds on the table, everything you lay in that turn must add up to **at least 51 points**.
- After opening, the 51 rule no longer applies: you can lay new melds freely and add cards to any meld on the table (yours or another player's).

### Card values for the 51 rule

| Card | Value |
|---|---|
| Ace low (A-2-3) | 1 |
| Ace in a set of aces, or high (Q-K-A) | 10 |
| J, Q, K | 10 |
| 2–10 | face value |
| Joker | value of the card it replaces |

## 6. Going out with a "hand"

A hand is going out in a single move. Only a player who **hasn't opened** that round can do it. You have 15 cards: you keep 14 and throw the 15th onto the discard pile.

1. **Veliki hand:** all 14 cards are laid down as valid melds in one move (the 51 rule doesn't apply).
2. **Mali hand:** the 14 cards add up to **less than 51**, counting joker = 0 and ace = 1. Nothing is laid down.
3. **Four jokers:** you hold all 4 jokers, whatever your other cards are. Nothing is laid down; the hand is shown at the end of the round.

## 7. Joker swap

- A player who has **opened** may take a joker from a meld on the table by putting the real card it stands for in its place:
  - **Run:** the exact card (same rank and suit).
  - **Set:** a card of the same rank in a suit not already in the set. A set's joker can be swapped only when the set has **all 4 cards**. In a 3-card set it could stand for either of the two missing suits.
- The joker goes to your hand and **must be laid down in the same turn** (in a new meld or added to an existing one) before you discard.
- You may take several jokers in the same turn; each one must be on the table before you discard.
- A joker can't be swapped for another joker.

## 8. Four of a kind

- When a set becomes **four real cards of the same rank** (no joker), it's removed from the table and put at the **bottom of the discard pile**, and every player is shown it.
- Exception: if completing those four cards is the move that ends the round, they stay on the table so everyone can see how the round was won.

## 9. End of the round

- The round ends when a player gets rid of all their cards by throwing the last one onto the discard pile, or goes out with a hand.

### Scoring

| Player | Points |
|---|---|
| Winner (went out) | **−10** |
| Didn't open | **+100** |
| Opened but didn't go out | **sum of the cards left in hand** |

Values for the cards left in hand: **ace = 10, joker = 20, J/Q/K = 10**, other cards at face value.

### Multiplier when the winner goes out with a hand

Every player's score for the round (the winner's −10 included) is multiplied:

| Hand | Multiplier | Winner | Didn't open |
|---|---|---|---|
| Mali or veliki hand | ×2 | −20 | +200 |
| Four jokers | ×3 | −30 | +300 |

Players who opened but didn't go out get their hand sum ×2 or ×3.

### Next round

- After the winner announcement, every player sees the score table. The next round starts when **every player** has clicked "Sledeca partija", or the host starts it.
