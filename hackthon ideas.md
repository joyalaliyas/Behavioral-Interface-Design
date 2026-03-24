# Reality Distortion Mode

## Concept
A browser extension that modifies what users SEE on screen to reduce digital addiction by removing dopamine-triggering UI elements.

## Core Features

### 1. UI Element Hiding
- **Hide addictive elements:**
  - Like counts
  - Comments sections  
  - Recommendation feeds
- **Visual modifications:**
  - Blur thumbnails
  - Convert YouTube homepage to search-only interface

### 2. Doomscroll Gravity (Advanced Feature)
- **Tracking:**
  - Measures scroll velocity
  - Monitors DOM changes to detect infinite scrolling patterns
- **Intelligence:**
  - Differentiates between intentional reading (e.g., documentation) and mindless doomscrolling (e.g., Shorts, Reels)
- **Intervention:**
  - When doomscrolling is detected, injects a 2D physics engine
  - UI elements physically unstick and fall into a pile at screen bottom
  - Interface becomes unusable, forcing a break

## Technical Implementation
- **Type:** JavaScript browser extension (Chrome/Firefox)
- **Libraries:** Open-source JS gravity/physics engines
- **Detection:** Scroll tracking + DOM change monitoring

## Why This Wins
1. **Visual Impact:** Highly engaging, hilarious demo potential
2. **Practical:** Addresses real digital addiction problems
3. **Technical Feasibility:** Uses existing open-source libraries
4. **User Experience:** Creative, memorable intervention method

## Potential Extensions
- Customizable element hiding (user chooses what to remove)
- Time-based interventions (gradual UI degradation)
- Statistics dashboard showing "saved time"
- Whitelist for productive websites
