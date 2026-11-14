use std::cell::RefCell;
use std::f64::consts::{E, PI};

#[derive(Clone, Copy, Debug)]
struct Complex {
    re: f64,
    im: f64,
}

impl Complex {
    const fn new(re: f64, im: f64) -> Self { Self { re, im } }
    fn abs(self) -> f64 { self.re.hypot(self.im) }
    fn add(self, other: Self) -> Self { Self::new(self.re + other.re, self.im + other.im) }
    fn sub(self, other: Self) -> Self { Self::new(self.re - other.re, self.im - other.im) }
    fn mul(self, other: Self) -> Self {
        Self::new(self.re * other.re - self.im * other.im, self.re * other.im + self.im * other.re)
    }
    fn div(self, other: Self) -> Self {
        let denominator = other.re * other.re + other.im * other.im;
        Self::new(
            (self.re * other.re + self.im * other.im) / denominator,
            (self.im * other.re - self.re * other.im) / denominator,
        )
    }
    fn exp(self) -> Self {
        let magnitude = self.re.exp();
        Self::new(magnitude * self.im.cos(), magnitude * self.im.sin())
    }
    fn log(self) -> Self { Self::new(self.abs().ln(), self.im.atan2(self.re)) }
    fn sqrt(self) -> Self {
        let radius = self.abs().sqrt();
        let angle = self.im.atan2(self.re) / 2.0;
        Self::new(radius * angle.cos(), radius * angle.sin())
    }
    fn sin(self) -> Self {
        Self::new(self.re.sin() * self.im.cosh(), self.re.cos() * self.im.sinh())
    }
    fn cos(self) -> Self {
        Self::new(self.re.cos() * self.im.cosh(), -self.re.sin() * self.im.sinh())
    }
    fn pow_integer(self, exponent: i32) -> Self {
        let mut power = exponent.unsigned_abs();
        let mut factor = self;
        let mut result = Self::new(1.0, 0.0);
        while power > 0 {
            if power & 1 == 1 { result = result.mul(factor); }
            factor = factor.mul(factor);
            power >>= 1;
        }
        if exponent < 0 { Self::new(1.0, 0.0).div(result) } else { result }
    }
}

#[derive(Clone, Copy)]
struct Dual {
    value: Complex,
    derivative: Complex,
}

#[derive(Clone, Copy, PartialEq)]
enum Function { Sin, Cos, Exp, Log, Sqrt }

#[derive(Clone, Copy, PartialEq)]
enum Operator { Add, Subtract, Multiply, Divide, Power }

enum Expr {
    Constant(f64),
    Symbol(Symbol),
    UnaryMinus(Box<Expr>),
    UnaryPlus(Box<Expr>),
    Binary(Operator, Box<Expr>, Box<Expr>),
    Function(Function, Box<Expr>),
}

#[derive(Clone, Copy)]
enum Symbol { Z, I, Pi, E }

struct NewtonEquation {
    expression: Expr,
    roots: Vec<Complex>,
    colors: Vec<[u8; 3]>,
}

impl Expr {
    fn has_z(&self) -> bool {
        match self {
            Self::Constant(_) | Self::Symbol(Symbol::I | Symbol::Pi | Symbol::E) => false,
            Self::Symbol(Symbol::Z) => true,
            Self::UnaryMinus(a) | Self::UnaryPlus(a) | Self::Function(_, a) => a.has_z(),
            Self::Binary(_, a, b) => a.has_z() || b.has_z(),
        }
    }

    fn polynomial_coefficients(&self) -> Option<Vec<Complex>> {
        match self {
            Self::Constant(value) => Some(vec![Complex::new(*value, 0.0)]),
            Self::Symbol(Symbol::Z) => Some(vec![Complex::new(0.0, 0.0), Complex::new(1.0, 0.0)]),
            Self::Symbol(Symbol::I) => Some(vec![Complex::new(0.0, 1.0)]),
            Self::Symbol(Symbol::Pi) => Some(vec![Complex::new(PI, 0.0)]),
            Self::Symbol(Symbol::E) => Some(vec![Complex::new(E, 0.0)]),
            Self::UnaryPlus(argument) => argument.polynomial_coefficients(),
            Self::UnaryMinus(argument) => Some(poly_scale(argument.polynomial_coefficients()?, Complex::new(-1.0, 0.0))),
            Self::Function(_, _) => None,
            Self::Binary(operator, left, right) => {
                let a = left.polynomial_coefficients()?;
                let b = right.polynomial_coefficients()?;
                match operator {
                    Operator::Add => Some(poly_add(&a, &b)),
                    Operator::Subtract => Some(poly_add(&a, &poly_scale(b, Complex::new(-1.0, 0.0)))),
                    Operator::Multiply => Some(poly_multiply(&a, &b)),
                    Operator::Divide => {
                        if b.len() == 1 && b[0].abs() > 1e-15 { Some(poly_scale(a, Complex::new(1.0, 0.0).div(b[0]))) }
                        else { None }
                    }
                    Operator::Power => {
                        if b.len() != 1 || b[0].im.abs() > 1e-12 || b[0].re.fract().abs() > 1e-12
                            || !(0.0..=64.0).contains(&b[0].re)
                        { return None; }
                        let mut result = vec![Complex::new(1.0, 0.0)];
                        for _ in 0..(b[0].re as usize) { result = poly_multiply(&result, &a); }
                        Some(result)
                    }
                }
            }
        }
    }

    fn evaluate(&self, z: Complex) -> Dual {
        match self {
            Self::Constant(value) => Dual { value: Complex::new(*value, 0.0), derivative: Complex::new(0.0, 0.0) },
            Self::Symbol(Symbol::Z) => Dual { value: z, derivative: Complex::new(1.0, 0.0) },
            Self::Symbol(Symbol::I) => Dual { value: Complex::new(0.0, 1.0), derivative: Complex::new(0.0, 0.0) },
            Self::Symbol(Symbol::Pi) => Dual { value: Complex::new(PI, 0.0), derivative: Complex::new(0.0, 0.0) },
            Self::Symbol(Symbol::E) => Dual { value: Complex::new(E, 0.0), derivative: Complex::new(0.0, 0.0) },
            Self::UnaryPlus(a) => a.evaluate(z),
            Self::UnaryMinus(a) => {
                let result = a.evaluate(z);
                Dual {
                    value: Complex::new(-result.value.re, -result.value.im),
                    derivative: Complex::new(-result.derivative.re, -result.derivative.im),
                }
            }
            Self::Function(function, argument) => {
                let a = argument.evaluate(z);
                let (value, slope) = match function {
                    Function::Sin => (a.value.sin(), a.value.cos()),
                    Function::Cos => {
                        let sin = a.value.sin();
                        (a.value.cos(), Complex::new(-sin.re, -sin.im))
                    }
                    Function::Exp => { let value = a.value.exp(); (value, value) }
                    Function::Log => (a.value.log(), Complex::new(1.0, 0.0).div(a.value)),
                    Function::Sqrt => {
                        let value = a.value.sqrt();
                        (value, Complex::new(1.0, 0.0).div(Complex::new(2.0, 0.0).mul(value)))
                    }
                };
                Dual { value, derivative: slope.mul(a.derivative) }
            }
            Self::Binary(operator, left, right) => {
                let a = left.evaluate(z);
                let b = right.evaluate(z);
                match operator {
                    Operator::Add => Dual { value: a.value.add(b.value), derivative: a.derivative.add(b.derivative) },
                    Operator::Subtract => Dual { value: a.value.sub(b.value), derivative: a.derivative.sub(b.derivative) },
                    Operator::Multiply => Dual {
                        value: a.value.mul(b.value),
                        derivative: a.derivative.mul(b.value).add(a.value.mul(b.derivative)),
                    },
                    Operator::Divide => Dual {
                        value: a.value.div(b.value),
                        derivative: a.derivative.mul(b.value).sub(a.value.mul(b.derivative)).div(b.value.mul(b.value)),
                    },
                    Operator::Power => {
                        if b.value.im == 0.0 && b.derivative.re == 0.0 && b.derivative.im == 0.0
                            && b.value.re.fract() == 0.0 && b.value.re.abs() < 10_000.0
                        {
                            let exponent = b.value.re as i32;
                            let value = a.value.pow_integer(exponent);
                            let derivative = if exponent == 0 {
                                Complex::new(0.0, 0.0)
                            } else {
                                Complex::new(exponent as f64, 0.0)
                                    .mul(a.value.pow_integer(exponent - 1))
                                    .mul(a.derivative)
                            };
                            Dual { value, derivative }
                        } else {
                            let logarithm = a.value.log();
                            let value = b.value.mul(logarithm).exp();
                            let derivative = value.mul(
                                b.derivative.mul(logarithm)
                                    .add(b.value.mul(a.derivative).div(a.value)),
                            );
                            Dual { value, derivative }
                        }
                    }
                }
            }
        }
    }
}

enum Token { Number(f64), Name(String), Plus, Minus, Star, Slash, Caret, LeftParen, RightParen, End }

struct Parser { tokens: Vec<Token>, cursor: usize }

impl Parser {
    fn tokenize(source: &str) -> Result<Vec<Token>, String> {
        let chars: Vec<char> = source.chars().collect();
        let mut tokens = Vec::new();
        let mut i = 0;
        while i < chars.len() {
            if chars[i].is_whitespace() { i += 1; continue; }
            let ch = chars[i];
            let simple = match ch {
                '+' => Some(Token::Plus), '-' => Some(Token::Minus), '*' => Some(Token::Star),
                '/' => Some(Token::Slash), '^' => Some(Token::Caret), '(' => Some(Token::LeftParen),
                ')' => Some(Token::RightParen), _ => None,
            };
            if let Some(token) = simple { tokens.push(token); i += 1; continue; }
            if ch.is_ascii_digit() || ch == '.' {
                let start = i;
                let mut saw_digit = false;
                while i < chars.len() && chars[i].is_ascii_digit() { saw_digit = true; i += 1; }
                if i < chars.len() && chars[i] == '.' {
                    i += 1;
                    while i < chars.len() && chars[i].is_ascii_digit() { saw_digit = true; i += 1; }
                }
                if !saw_digit { return Err("A decimal point must be part of a number.".into()); }
                if i < chars.len() && matches!(chars[i], 'e' | 'E') {
                    let exponent_mark = i;
                    i += 1;
                    if i < chars.len() && matches!(chars[i], '+' | '-') { i += 1; }
                    let digits_start = i;
                    while i < chars.len() && chars[i].is_ascii_digit() { i += 1; }
                    if digits_start == i { i = exponent_mark; }
                }
                let spelling: String = chars[start..i].iter().collect();
                let value = spelling.parse::<f64>().map_err(|_| "Invalid number in equation.".to_string())?;
                tokens.push(Token::Number(value));
                continue;
            }
            if ch.is_ascii_alphabetic() {
                let start = i;
                while i < chars.len() && chars[i].is_ascii_alphabetic() { i += 1; }
                tokens.push(Token::Name(chars[start..i].iter().collect::<String>().to_ascii_lowercase()));
                continue;
            }
            return Err(format!("Unsupported character '{ch}'."));
        }
        tokens.push(Token::End);
        Ok(tokens)
    }

    fn new(source: &str) -> Result<Self, String> { Ok(Self { tokens: Self::tokenize(source)?, cursor: 0 }) }
    fn peek(&self) -> &Token { &self.tokens[self.cursor] }
    fn take(&mut self, expected: &str) -> Result<(), String> {
        let matches = matches!((expected, self.peek()),
            ("(", Token::LeftParen) | (")", Token::RightParen));
        if !matches { return Err(format!("Expected '{expected}'.")); }
        self.cursor += 1;
        Ok(())
    }
    fn parse(mut self) -> Result<Expr, String> {
        let expression = self.expression()?;
        if !matches!(self.peek(), Token::End) { return Err("Extra text after the equation.".into()); }
        if !expression.has_z() { return Err("The function must include z.".into()); }
        Ok(expression)
    }
    fn primary(&mut self) -> Result<Expr, String> {
        match self.peek() {
            Token::Number(value) => { let value = *value; self.cursor += 1; Ok(Expr::Constant(value)) }
            Token::LeftParen => {
                self.cursor += 1;
                let expression = self.expression()?;
                self.take(")")?;
                Ok(expression)
            }
            Token::Name(name) => {
                let name = name.clone();
                self.cursor += 1;
                match name.as_str() {
                    "z" => Ok(Expr::Symbol(Symbol::Z)),
                    "i" => Ok(Expr::Symbol(Symbol::I)),
                    "pi" => Ok(Expr::Symbol(Symbol::Pi)),
                    "e" => Ok(Expr::Symbol(Symbol::E)),
                    "sin" | "cos" | "exp" | "log" | "sqrt" => {
                        self.take("(")?;
                        let argument = self.expression()?;
                        self.take(")")?;
                        let function = match name.as_str() {
                            "sin" => Function::Sin, "cos" => Function::Cos, "exp" => Function::Exp,
                            "log" => Function::Log, _ => Function::Sqrt,
                        };
                        Ok(Expr::Function(function, Box::new(argument)))
                    }
                    _ => Err(format!("Unknown name '{name}'.")),
                }
            }
            _ => Err("Expected a number, z, function, or parenthesized expression.".into()),
        }
    }
    fn power(&mut self) -> Result<Expr, String> {
        let mut node = self.primary()?;
        if matches!(self.peek(), Token::Caret) {
            self.cursor += 1;
            node = Expr::Binary(Operator::Power, Box::new(node), Box::new(self.unary()?));
        }
        Ok(node)
    }
    fn unary(&mut self) -> Result<Expr, String> {
        match self.peek() {
            Token::Plus => { self.cursor += 1; Ok(Expr::UnaryPlus(Box::new(self.unary()?))) }
            Token::Minus => { self.cursor += 1; Ok(Expr::UnaryMinus(Box::new(self.unary()?))) }
            _ => self.power(),
        }
    }
    fn term(&mut self) -> Result<Expr, String> {
        let mut node = self.unary()?;
        loop {
            let operator = match self.peek() { Token::Star => Operator::Multiply, Token::Slash => Operator::Divide, _ => break };
            self.cursor += 1;
            node = Expr::Binary(operator, Box::new(node), Box::new(self.unary()?));
        }
        Ok(node)
    }
    fn expression(&mut self) -> Result<Expr, String> {
        let mut node = self.term()?;
        loop {
            let operator = match self.peek() { Token::Plus => Operator::Add, Token::Minus => Operator::Subtract, _ => break };
            self.cursor += 1;
            node = Expr::Binary(operator, Box::new(node), Box::new(self.term()?));
        }
        Ok(node)
    }
}

thread_local! { static NEWTON_EQUATION: RefCell<Option<NewtonEquation>> = const { RefCell::new(None) }; }

fn poly_trim(mut coefficients: Vec<Complex>) -> Vec<Complex> {
    while coefficients.len() > 1 && coefficients.last().is_some_and(|coefficient| coefficient.abs() < 1e-14) {
        coefficients.pop();
    }
    coefficients
}

fn poly_scale(coefficients: Vec<Complex>, scale: Complex) -> Vec<Complex> {
    poly_trim(coefficients.into_iter().map(|coefficient| coefficient.mul(scale)).collect())
}

fn poly_add(a: &[Complex], b: &[Complex]) -> Vec<Complex> {
    let mut result = vec![Complex::new(0.0, 0.0); a.len().max(b.len())];
    for (index, coefficient) in a.iter().enumerate() { result[index] = result[index].add(*coefficient); }
    for (index, coefficient) in b.iter().enumerate() { result[index] = result[index].add(*coefficient); }
    poly_trim(result)
}

fn poly_multiply(a: &[Complex], b: &[Complex]) -> Vec<Complex> {
    let mut result = vec![Complex::new(0.0, 0.0); a.len() + b.len() - 1];
    for (i, left) in a.iter().enumerate() {
        for (j, right) in b.iter().enumerate() {
            result[i + j] = result[i + j].add(left.mul(*right));
        }
    }
    poly_trim(result)
}

fn evaluate_polynomial(coefficients: &[Complex], z: Complex) -> Complex {
    coefficients.iter().rev().fold(Complex::new(0.0, 0.0), |sum, coefficient| sum.mul(z).add(*coefficient))
}

fn polynomial_roots(coefficients: &[Complex]) -> Vec<Complex> {
    let coefficients = poly_trim(coefficients.to_vec());
    if coefficients.len() <= 1 { return Vec::new(); }
    let leading = *coefficients.last().unwrap();
    let monic: Vec<Complex> = coefficients.iter().map(|coefficient| coefficient.div(leading)).collect();
    let degree = monic.len() - 1;
    let seed = Complex::new(0.4, 0.9);
    let mut roots: Vec<Complex> = (0..degree).map(|index| seed.pow_integer(index as i32)).collect();
    for _ in 0..60 {
        let previous = roots.clone();
        roots = previous.iter().enumerate().map(|(index, root)| {
            let denominator = previous.iter().enumerate()
                .filter(|(other_index, _)| *other_index != index)
                .fold(Complex::new(1.0, 0.0), |product, (_, other)| product.mul(root.sub(*other)));
            if denominator.abs() < 1e-24 { *root }
            else { root.sub(evaluate_polynomial(&monic, *root).div(denominator)) }
        }).collect();
    }
    roots
}

fn discover_roots(expression: &Expr) -> Vec<Complex> {
    let mut roots = Vec::new();
    for yi in -5..=5 {
        for xi in -5..=5 {
            if let Some((root, _)) = newton_sample(Complex::new(xi as f64, yi as f64), expression, 120) {
                if !roots.iter().any(|known: &Complex| known.sub(root).abs() < 1e-4) { roots.push(root); }
            }
        }
    }
    roots
}

fn rgb_for_hue(hue: f64) -> [u8; 3] {
    let x = (255.0 * (1.0 - ((hue / 60.0) % 2.0 - 1.0).abs())) as u8;
    match (hue as i32) / 60 {
        0 => [255, x, 0], 1 => [x, 255, 0], 2 => [0, 255, x],
        3 => [0, x, 255], 4 => [x, 0, 255], 5 => [255, 0, x],
        _ => [255, 0, 0],
    }
}

fn root_colors(roots: &mut [Complex]) -> Vec<[u8; 3]> {
    roots.sort_by(|a, b| a.im.atan2(a.re).total_cmp(&b.im.atan2(b.re)));
    if roots.is_empty() { return Vec::new(); }
    let hue_step = 360.0 / roots.len() as f64;
    (0..roots.len()).map(|index| rgb_for_hue(hue_step * index as f64)).collect()
}

fn equation_from_bytes(ptr: *const u8, len: usize) -> Result<String, String> {
    if ptr.is_null() || len == 0 { return Err("Equation is empty.".into()); }
    // The JavaScript worker allocates this buffer in this WASM module and passes its exact length.
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    std::str::from_utf8(bytes).map(str::to_owned).map_err(|_| "Equation must be UTF-8 text.".into())
}

#[no_mangle]
pub extern "C" fn memory_alloc(size: usize) -> *mut u8 {
    Box::into_raw(vec![0_u8; size].into_boxed_slice()) as *mut u8
}

#[no_mangle]
pub unsafe extern "C" fn memory_free(ptr: *mut u8, size: usize) {
    if !ptr.is_null() { drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, size))); }
}

#[no_mangle]
pub unsafe extern "C" fn validate_equation(ptr: *const u8, len: usize) -> i32 {
    match equation_from_bytes(ptr, len).and_then(|source| Parser::new(&source)?.parse().map(|_| ())) {
        Ok(()) => 0,
        Err(_) => -1,
    }
}

#[no_mangle]
pub unsafe extern "C" fn set_equation(ptr: *const u8, len: usize) -> i32 {
    let parsed = equation_from_bytes(ptr, len).and_then(|source| Parser::new(&source)?.parse());
    match parsed {
        Ok(expression) => {
            let mut roots = expression.polynomial_coefficients()
                .map(|coefficients| polynomial_roots(&coefficients))
                .unwrap_or_else(|| discover_roots(&expression));
            let colors = root_colors(&mut roots);
            let equation = NewtonEquation { expression, roots, colors };
            NEWTON_EQUATION.with(|slot| *slot.borrow_mut() = Some(equation));
            0
        }
        Err(_) => -1,
    }
}

#[no_mangle]
pub extern "C" fn root_count() -> u32 {
    NEWTON_EQUATION.with(|slot| slot.borrow().as_ref().map_or(0, |equation| equation.roots.len() as u32))
}

#[no_mangle]
pub extern "C" fn root_color(index: u32) -> u32 {
    NEWTON_EQUATION.with(|slot| {
        slot.borrow().as_ref()
            .and_then(|equation| equation.colors.get(index as usize))
            .map_or(0, |color| ((color[0] as u32) << 16) | ((color[1] as u32) << 8) | color[2] as u32)
    })
}

#[no_mangle]
pub extern "C" fn set_root_color(index: u32, rgb: u32) -> i32 {
    NEWTON_EQUATION.with(|slot| {
        let mut borrowed = slot.borrow_mut();
        let Some(equation) = borrowed.as_mut() else { return -1; };
        let Some(color) = equation.colors.get_mut(index as usize) else { return -1; };
        *color = [(rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8];
        0
    })
}

#[no_mangle]
pub unsafe extern "C" fn render_tile(
    width: u32, height: u32, first_row: u32, row_count: u32,
    center_x: f64, center_y: f64, vertical_span: f64,
    max_iterations: u32, color_scale: f64, palette_id: u32, mode: u32,
    output_ptr: *mut u8, output_len: usize,
) -> i32 {
    if width == 0 || height == 0 || row_count == 0 || first_row.saturating_add(row_count) > height
        || !vertical_span.is_finite() || vertical_span <= 0.0 || max_iterations == 0
        || output_ptr.is_null() || palette_id > 3 || mode > 1
    { return -1; }
    let Some(expected_len) = (width as usize).checked_mul(row_count as usize).and_then(|n| n.checked_mul(4)) else { return -1; };
    if output_len != expected_len { return -1; }
    let output = std::slice::from_raw_parts_mut(output_ptr, output_len);
    if mode == 1 {
        NEWTON_EQUATION.with(|slot| {
            let borrowed = slot.borrow();
            let Some(equation) = borrowed.as_ref() else { return -2; };
            render_rows(output, width, height, first_row, row_count, center_x, center_y, vertical_span,
                max_iterations, color_scale, palette_id, Some(equation));
            0
        })
    } else {
        render_rows(output, width, height, first_row, row_count, center_x, center_y, vertical_span,
            max_iterations, color_scale, palette_id, None);
        0
    }
}

fn render_rows(
    output: &mut [u8], width: u32, height: u32, first_row: u32, row_count: u32,
    center_x: f64, center_y: f64, vertical_span: f64,
    max_iterations: u32, color_scale: f64, palette_id: u32, equation: Option<&NewtonEquation>,
) {
    let units_per_pixel = vertical_span / height as f64;
    let first_x = center_x - width as f64 * units_per_pixel / 2.0;
    let first_y = center_y + height as f64 * units_per_pixel / 2.0;
    for local_y in 0..row_count {
        let y = first_row + local_y;
        let ci = first_y - (y as f64 + 0.5) * units_per_pixel;
        for x in 0..width {
            let cr = first_x + (x as f64 + 0.5) * units_per_pixel;
            let color = if let Some(function) = equation {
                newton_color(newton_sample(Complex::new(cr, ci), &function.expression, max_iterations), function)
            } else {
                mandelbrot_color(cr, ci, max_iterations, color_scale, palette_id)
            };
            let offset = ((local_y as usize * width as usize) + x as usize) * 4;
            output[offset] = color[0];
            output[offset + 1] = color[1];
            output[offset + 2] = color[2];
            output[offset + 3] = 255;
        }
    }
}

fn inside_main_cardioid(x: f64, y: f64) -> bool {
    let shifted_x = x - 0.25;
    let q = shifted_x * shifted_x + y * y;
    q * (q + shifted_x) <= 0.25 * y * y
}

fn inside_period_two_bulb(x: f64, y: f64) -> bool { (x + 1.0).powi(2) + y * y <= 1.0 / 16.0 }

fn palette(id: u32) -> &'static [[u8; 3]] {
    const AURORA: [[u8; 3]; 6] = [[15,31,77],[76,72,171],[185,93,190],[245,137,163],[245,215,133],[45,174,176]];
    const EMBER: [[u8; 3]; 5] = [[37,19,47],[115,36,68],[211,72,69],[248,148,76],[250,220,130]];
    const OCEAN: [[u8; 3]; 5] = [[7,24,48],[13,83,119],[16,160,166],[114,222,185],[224,247,214]];
    const MONO: [[u8; 3]; 4] = [[13,15,21],[66,71,83],[145,149,158],[247,245,233]];
    match id { 1 => &EMBER, 2 => &OCEAN, 3 => &MONO, _ => &AURORA }
}

fn mix(a: [u8; 3], b: [u8; 3], amount: f64) -> [u8; 3] {
    [0, 1, 2].map(|channel| (a[channel] as f64 + (b[channel] as f64 - a[channel] as f64) * amount).round() as u8)
}

fn palette_color(value: f64, color_scale: f64, palette_id: u32) -> [u8; 3] {
    let stops = palette(palette_id);
    let period = color_scale.max(1.0);
    let phase = (value / period).rem_euclid(1.0);
    let scaled = phase * (stops.len() - 1) as f64;
    let index = scaled.floor() as usize;
    mix(stops[index], stops[(index + 1).min(stops.len() - 1)], scaled - index as f64)
}

fn mandelbrot_color(x: f64, y: f64, max_iterations: u32, color_scale: f64, palette_id: u32) -> [u8; 3] {
    if inside_main_cardioid(x, y) || inside_period_two_bulb(x, y) { return [7, 9, 15]; }
    let (mut zr, mut zi) = (0.0, 0.0);
    let mut magnitude_squared = 0.0;
    let mut iteration = 0;
    while iteration < max_iterations && magnitude_squared <= 4.0 {
        let next_re = zr * zr - zi * zi + x;
        zi = 2.0 * zr * zi + y;
        zr = next_re;
        magnitude_squared = zr * zr + zi * zi;
        iteration += 1;
    }
    if magnitude_squared <= 4.0 { return [7, 9, 15]; }
    let smooth = iteration as f64 + 1.0 - (magnitude_squared.sqrt().ln().ln() / std::f64::consts::LN_2);
    palette_color(smooth.max(0.0), color_scale, palette_id)
}

fn newton_sample(start: Complex, equation: &Expr, max_iterations: u32) -> Option<(Complex, u32)> {
    let mut point = start;
    for iteration in 0..max_iterations {
        let result = equation.evaluate(point);
        let magnitude = result.value.abs();
        if !magnitude.is_finite() || !result.derivative.re.is_finite() || !result.derivative.im.is_finite() { return None; }
        if magnitude < 1e-5 { return Some((point, iteration)); }
        let derivative_size = result.derivative.re * result.derivative.re + result.derivative.im * result.derivative.im;
        if derivative_size < 1e-20 { return None; }
        point = point.sub(result.value.div(result.derivative));
        if !point.re.is_finite() || !point.im.is_finite() || point.abs() > 1e8 { return None; }
    }
    None
}

fn newton_color(sample: Option<(Complex, u32)>, equation: &NewtonEquation) -> [u8; 3] {
    let Some((root, iteration)) = sample else { return [7, 9, 15]; };
    let Some((root_index, _)) = equation.roots.iter().enumerate().min_by(|(_, a), (_, b)| {
        a.sub(root).abs().total_cmp(&b.sub(root).abs())
    }) else { return [7, 9, 15]; };
    let Some(color) = equation.colors.get(root_index) else { return [7, 9, 15]; };
    const MAX_ITERATION: f64 = 200.0;
    let color_iteration = iteration.saturating_sub(1) as f64;
    let brightness = ((1.0 - color_iteration / MAX_ITERATION) / (1.0 + color_iteration / 3.0)).clamp(0.0, 1.0);
    color.map(|channel| (channel as f64 * brightness) as u8)
}
