/** Each car keeps one color everywhere, picked from its id: `car-tone-0` to `car-tone-3` in globals.css. */
export const carTone = (carId: number) => `car-tone-${(((carId - 1) % 4) + 4) % 4}`;
