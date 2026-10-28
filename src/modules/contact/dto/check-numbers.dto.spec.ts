import { validate } from 'class-validator';
import { BULK_NUMBER_CHECK_MAX, CheckNumbersDto } from './check-numbers.dto';

function dto(numbers: unknown): CheckNumbersDto {
  return Object.assign(new CheckNumbersDto(), { numbers });
}

describe('CheckNumbersDto', () => {
  it('accepts digits-only numbers and an optional leading plus', async () => {
    await expect(validate(dto(['919876543210', '+628123456789']))).resolves.toHaveLength(0);
  });

  it.each([[[]], [['1234']], [['+91 9876543210']], [['abc']], [[919876543210]]])(
    'rejects an invalid numbers array: %p',
    async (numbers: unknown[]) => {
      expect(await validate(dto(numbers))).not.toHaveLength(0);
    },
  );

  it('rejects more than 100 numbers', async () => {
    const numbers = Array.from({ length: BULK_NUMBER_CHECK_MAX + 1 }, (_, i) => `9198765${String(i).padStart(5, '0')}`);
    expect(await validate(dto(numbers))).not.toHaveLength(0);
  });
});
